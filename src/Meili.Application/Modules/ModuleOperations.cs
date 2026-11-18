using System.Text.Json;
using System.Text.RegularExpressions;

namespace Meili.Automation.Modules;

public sealed record ModuleOperation(string Name, string Description, bool Writes, JsonElement Schema, string EntryPoint, string[]? HostOperations = null, string[]? EngineAssets = null);
public sealed record BoundModuleOperation(string AppId, string Version, ModuleOperation Definition, string PackageSha256);

/// <summary>Authenticated discovery only; never starts an engine or grants write permission.</summary>
public static partial class ModuleOperations
{
    public static Task<IReadOnlyList<BoundModuleOperation>> ReadAsync(string directory, CancellationToken ct = default) =>
        ReadAsync(directory, new ModuleInstaller(directory), ct);

    internal static async Task<IReadOnlyList<BoundModuleOperation>> ReadAsync(string directory,ModuleInstaller installer,CancellationToken ct)=>
        (await ReadSnapshotAsync(directory,installer,ct).ConfigureAwait(false)).Operations;
    public static Task<ModuleDiscovery> ReadSnapshotAsync(string directory,CancellationToken ct=default)=>ReadSnapshotAsync(directory,new ModuleInstaller(directory),ct);
    internal static async Task<ModuleDiscovery> ReadSnapshotAsync(string directory,ModuleInstaller installer,CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();var result=new List<BoundModuleOperation>();var issues=new List<OperationCatalogIssue>();
        ModuleRegistryState state;
        try{state=installer.Inspect().State;}
        catch(Exception ex)when(ex is IOException or InvalidDataException or JsonException or UnauthorizedAccessException or InvalidOperationException)
        {
            // expected: report immutable diagnostics; never recreate a corrupt registry or activate seed apps.
            return new(Array.AsReadOnly(result.ToArray()),Array.AsReadOnly(new[]{new OperationCatalogIssue(null,"app_registry_unavailable","Application registry is unavailable; preserve the file and inspect apps doctor. Built-in host tools remain available.")}),null);
        }
        foreach(var app in state.Apps.Where(app=>app.Enabled))
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var verified=await installer.VerifySnapshotAsync(app,ct).ConfigureAwait(false);
                var operations=ReadPackage(verified,installer.InstalledArchive(app));
                if(operations.Any(bound=>result.Any(previous=>previous.Definition.Name==bound.Definition.Name)))throw new InvalidDataException("Duplicate module operation.");
                result.AddRange(operations);
            }
            catch(Exception ex)when(ex is IOException or InvalidDataException or JsonException or UnauthorizedAccessException or InvalidOperationException or ArgumentException)
            {
                // expected: quarantine discovery for this app only; diagnostics stay explicit and archives/data are preserved.
                issues.Add(new(app.Id,"app_verification_failed","Application unavailable; run apps doctor and restore a trusted package. Retained data are preserved."));
            }
        }
        return new(Array.AsReadOnly(result.ToArray()),Array.AsReadOnly(issues.ToArray()),state);
    }

    internal static IReadOnlyList<BoundModuleOperation> ReadPackage(VerifiedModule verified, string archive)
    {
        var result = new List<BoundModuleOperation>();
        var app = verified.Manifest;
        var metadata = app.Files.SingleOrDefault(f => f.Path == "operations.json");
        if (metadata is null)
        {
            if(app.Id is ModuleAccess.MarketLiquidity or ModuleAccess.NewsFundamentals)throw new InvalidDataException("Facade app must declare its public operations.");
            return result.AsReadOnly();
        }
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
                ModuleHostOperations.Validate(op.HostOperations,op.Writes);
                if(op.EngineAssets is {} dependencies)
                {
                    if(dependencies.Length>16||dependencies.Distinct(StringComparer.Ordinal).Count()!=dependencies.Length)throw new InvalidDataException("Invalid engine dependencies.");
                    long total=0;
                    foreach(var dependency in dependencies)
                    {
                        ModulePackage.ValidatePath(dependency);
                        var file=app.Files.SingleOrDefault(f=>f.Path==dependency);
                        if(!dependency.StartsWith("engine/",StringComparison.Ordinal)||!dependency.EndsWith(".mjs",StringComparison.Ordinal)||file is null)throw new InvalidDataException("Undeclared engine dependency.");
                        total+=file.Size;
                    }
                    if(total>128*1024*1024)throw new InvalidDataException("Engine dependency budget exceeded.");
                }
                ModulePackage.ValidatePath(op.EntryPoint);
                if (!op.EntryPoint.StartsWith("engine/", StringComparison.Ordinal) || !op.EntryPoint.EndsWith(".mjs", StringComparison.Ordinal) ||
                    !verified.Manifest.Files.Any(f => f.Path == op.EntryPoint)) throw new InvalidDataException("Missing module operation entrypoint.");
                var existing = OperationCatalog.All.FirstOrDefault(o => o.Name == op.Name);
                // A package cannot steal another domain's public tool, or change an established permission/schema.
                if (existing is not null && (ModuleAccess.OperationOwner(op.Name) != app.Id ||
                    existing.Writes != op.Writes || !JsonElement.DeepEquals(existing.Schema, op.Schema)))
                    throw new InvalidDataException("Incompatible or foreign operation replacement.");
                if (existing is null && !op.Name.StartsWith(app.Id == "easysellput.qqq-gex" ? "get_qqq_gex_" : "app_" + app.Id.Replace('.', '_').Replace('-', '_') + "_", StringComparison.Ordinal))
                    throw new InvalidDataException("Module operation is outside its namespace.");
                if (result.Any(o => o.Definition.Name == op.Name)) throw new InvalidDataException("Duplicate module operation.");
                result.Add(new(app.Id, app.Version, op with { Schema = op.Schema.Clone() }, verified.PackageSha256));
            }
        if(app.Id==ModuleAccess.MarketLiquidity && !result.Any(operation=>operation.Definition.Name=="get_market_liquidity"))
            throw new InvalidDataException("Liquidity app must preserve its public report operation.");
        if(app.Id==ModuleAccess.NewsFundamentals && new[]{"get_news","get_fundamentals","get_financials"}.Any(name=>!result.Any(operation=>operation.Definition.Name==name)))
            throw new InvalidDataException("News app must preserve all three public operations.");
        return result.AsReadOnly();
    }
    public static IOperationCatalog Merge(IEnumerable<BoundModuleOperation> contributions,IEnumerable<OperationCatalogIssue>? issues=null)
    {
        var items = OperationCatalog.All.ToList();
        foreach (var item in contributions)
        {
            var op = item.Definition;
            var index = items.FindIndex(o => o.Name == op.Name);
            var replacement = new Operation(op.Name, op.Description, op.Writes, op.Schema);
            if (index < 0) items.Add(replacement); else items[index] = replacement;
        }
        return new OperationSnapshot(items,issues);
    }
    private static void ValidateSchema(JsonElement schema, int depth)
    {
        if (depth > 12 || schema.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Unsupported module schema.");
        if (schema.EnumerateObject().Select(p => p.Name).Distinct(StringComparer.Ordinal).Count() != schema.EnumerateObject().Count())
            throw new InvalidDataException("Duplicate module schema field.");
        var allowed = new HashSet<string>(["type", "description", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "minimum", "maximum", "maxLength", "enum", "uniqueItems"]);
        if (schema.EnumerateObject().Any(p => !allowed.Contains(p.Name)) || !schema.TryGetProperty("type", out var type))
            throw new InvalidDataException("Unsupported module schema keyword.");
        if(schema.TryGetProperty("uniqueItems",out var unique)&&(type.GetString()!="array"||unique.ValueKind is not (JsonValueKind.True or JsonValueKind.False)))throw new InvalidDataException("Invalid uniqueness constraint.");
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
