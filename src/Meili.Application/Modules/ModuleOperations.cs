using System.Text.Json;
using System.Text.RegularExpressions;

namespace Meili.Automation.Modules;

public sealed record ModuleOperation(string Name, string Description, bool Writes, JsonElement Schema, string EntryPoint);
public sealed record BoundModuleOperation(string AppId, string Version, ModuleOperation Definition);

/// <summary>Authenticated discovery only; never starts an engine or grants write permission.</summary>
public static partial class ModuleOperations
{
    public static Task<IReadOnlyList<BoundModuleOperation>> ReadAsync(string directory, CancellationToken ct = default) =>
        ReadAsync(directory, new ModuleInstaller(directory), ct);

    internal static async Task<IReadOnlyList<BoundModuleOperation>> ReadAsync(string directory, ModuleInstaller installer, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var result = new List<BoundModuleOperation>();
        foreach (var app in installer.Inspect().State.Apps.Where(a => a.Enabled))
        {
            using var lease = new ModuleRegistry(directory).AcquireExecution(app.Id);
            var verified = await installer.VerifyInstalledAsync(app.Id, ct).ConfigureAwait(false);
            if (!verified.Manifest.Files.Any(f => f.Path == "operations.json")) continue;
            foreach (var bound in ReadPackage(verified, Path.Combine(new ModuleRegistry(directory).Root, "packages", app.Id, app.Version, "package.espapp")))
            {
                if (result.Any(o => o.Definition.Name == bound.Definition.Name)) throw new InvalidDataException("Duplicate module operation.");
                result.Add(bound);
            }
        }
        return result.AsReadOnly();
    }

    internal static IReadOnlyList<BoundModuleOperation> ReadPackage(VerifiedModule verified, string archive)
    {
        var result = new List<BoundModuleOperation>();
        var app = verified.Manifest;
        var metadata = app.Files.SingleOrDefault(f => f.Path == "operations.json");
        if (metadata is null) return result.AsReadOnly();
        if (metadata.Size > 262144) throw new InvalidDataException("Module operation metadata exceeds bounds.");
        using var zip = System.IO.Compression.ZipFile.OpenRead(archive);
        using var input = zip.GetEntry("operations.json")!.Open();
        using var output = new MemoryStream();
        var buffer = new byte[8192]; int count;
        while ((count = input.Read(buffer)) > 0)
        {
            if (output.Length + count > metadata.Size) throw new InvalidDataException("Module operation metadata exceeds bound.");
            output.Write(buffer, 0, count);
        }
        var bytes = output.ToArray();
        if (bytes.Length != metadata.Size || !Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).Equals(metadata.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Module operation metadata changed.");
        using (var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 16 })) ModulePackage.RejectDuplicates(document.RootElement);
        var operations = JsonSerializer.Deserialize<ModuleOperation[]>(bytes, new JsonSerializerOptions(JsonSerializerDefaults.Web)
        { UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow, MaxDepth = 16 })
            ?? throw new InvalidDataException("Missing module operations.");
        if (operations.Length > 64) throw new InvalidDataException("Too many module operations.");
            foreach (var op in operations)
            {
                if (op is null || string.IsNullOrEmpty(op.Name) || !NamePattern().IsMatch(op.Name) || string.IsNullOrWhiteSpace(op.Description) || op.Description.Length > 4000 ||
                    op.Schema.ValueKind != JsonValueKind.Object || !op.Schema.TryGetProperty("type", out var type) || type.GetString() != "object")
                    throw new InvalidDataException("Invalid module operation definition.");
                ValidateSchema(op.Schema, 0);
                ModulePackage.ValidatePath(op.EntryPoint);
                if (!op.EntryPoint.StartsWith("engine/", StringComparison.Ordinal) || !op.EntryPoint.EndsWith(".mjs", StringComparison.Ordinal) ||
                    !verified.Manifest.Files.Any(f => f.Path == op.EntryPoint)) throw new InvalidDataException("Missing module operation entrypoint.");
                var existing = OperationCatalog.All.FirstOrDefault(o => o.Name == op.Name);
                // A package cannot steal another domain's public tool, or change an established permission/schema.
                if (existing is not null && (app.Id != "easysellput.qqq-gex" || !op.Name.Contains("_qqq_gex_", StringComparison.Ordinal) ||
                    existing.Writes != op.Writes || !JsonElement.DeepEquals(existing.Schema, op.Schema)))
                    throw new InvalidDataException("Incompatible or foreign operation replacement.");
                if (existing is null && !op.Name.StartsWith(app.Id == "easysellput.qqq-gex" ? "get_qqq_gex_" : "app_" + app.Id.Replace('.', '_').Replace('-', '_') + "_", StringComparison.Ordinal))
                    throw new InvalidDataException("Module operation is outside its namespace.");
                if (result.Any(o => o.Definition.Name == op.Name)) throw new InvalidDataException("Duplicate module operation.");
                result.Add(new(app.Id, app.Version, op with { Schema = op.Schema.Clone() }));
            }
        return result.AsReadOnly();
    }
    public static IOperationCatalog Merge(IEnumerable<BoundModuleOperation> contributions)
    {
        var items = OperationCatalog.All.ToList();
        foreach (var item in contributions)
        {
            var op = item.Definition;
            var index = items.FindIndex(o => o.Name == op.Name);
            var replacement = new Operation(op.Name, op.Description, op.Writes, op.Schema);
            if (index < 0) items.Add(replacement); else items[index] = replacement;
        }
        return new OperationSnapshot(items);
    }
    private static void ValidateSchema(JsonElement schema, int depth)
    {
        if (depth > 12 || schema.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Unsupported module schema.");
        if (schema.EnumerateObject().Select(p => p.Name).Distinct(StringComparer.Ordinal).Count() != schema.EnumerateObject().Count())
            throw new InvalidDataException("Duplicate module schema field.");
        var allowed = new HashSet<string>(["type", "description", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "minimum", "maximum", "maxLength", "enum"]);
        if (schema.EnumerateObject().Any(p => !allowed.Contains(p.Name)) || !schema.TryGetProperty("type", out var type))
            throw new InvalidDataException("Unsupported module schema keyword.");
        switch (type.GetString())
        {
            case "object":
                if (!schema.TryGetProperty("properties", out var props) || props.ValueKind != JsonValueKind.Object || props.EnumerateObject().Count() > 64 ||
                    !schema.TryGetProperty("required", out var required) || required.ValueKind != JsonValueKind.Array ||
                    !schema.TryGetProperty("additionalProperties", out var extra) || extra.ValueKind != JsonValueKind.False)
                    throw new InvalidDataException("Module objects must be bounded and closed.");
                foreach (var property in props.EnumerateObject()) ValidateSchema(property.Value, depth + 1);
                foreach (var name in required.EnumerateArray())
                    if (name.ValueKind != JsonValueKind.String || !props.TryGetProperty(name.GetString()!, out _)) throw new InvalidDataException("Invalid required property.");
                break;
            case "array":
                if (!schema.TryGetProperty("items", out var items)) throw new InvalidDataException("Missing module array items.");
                ValidateSchema(items, depth + 1); break;
            case "string": case "number": case "integer": case "boolean": break;
            default: throw new InvalidDataException("Unsupported module schema type.");
        }
        foreach (var name in new[] { "minimum", "maximum", "minItems", "maxItems", "maxLength" })
            if (schema.TryGetProperty(name, out var bound) && (bound.ValueKind != JsonValueKind.Number || !bound.TryGetDouble(out var value) || !double.IsFinite(value)))
                throw new InvalidDataException("Invalid module schema bound.");
    }
    [GeneratedRegex("^[a-z][a-z0-9_]{1,99}$", RegexOptions.CultureInvariant)] private static partial Regex NamePattern();
}
