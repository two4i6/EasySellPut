using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Meili.Automation.Modules;

public sealed record ModuleFile(string Path, long Size, string Sha256);
public sealed record ModuleManifest(int SchemaVersion, string Repository, string Id, string Version,
    int HostApi, int EngineProtocol, int DataFormat, string Runtime, string Engine,
    string? Ui, string[] Platforms, ModuleFile[] Files, string? ModelVersion = null);
public sealed record VerifiedModule(ModuleManifest Manifest, string PackageSha256);

/// <summary>Validates first-party code packages without extracting, activating or modifying a profile.</summary>
public static partial class ModulePackage
{
    public const int HostApi = 1;
    public const int EngineProtocol = 1;
    public const long MaxBytes = 512L * 1024 * 1024;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };

    public static Task<VerifiedModule> VerifyAsync(string archive, CancellationToken ct = default)
    {
        if (!UpdateClient.IsConfigured) throw new InvalidOperationException("This build has no trusted module repository.");
        return VerifyAsync(archive, UpdateClient.PublicKey, UpdateClient.Repository, UpdateClient.RuntimeId, ct);
    }

    // Test composition only: production callers cannot select a repository or trust key.
    internal static async Task<VerifiedModule> VerifyAsync(string archive, string key, string repository, string rid, CancellationToken ct)
    {
        await using var input = new FileStream(archive, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (input.Length is <= 0 or > MaxBytes) throw new InvalidDataException("Module package size exceeds bounds.");
        var packageHash = Convert.ToHexString(await SHA256.HashDataAsync(input, ct)); input.Position = 0;
        using var zip = new ZipArchive(input, ZipArchiveMode.Read, true);
        if (zip.Entries.Count is < 3 or > 8192) throw new InvalidDataException("Invalid module entry count.");
        var entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
        long total = 0;
        foreach (var entry in zip.Entries)
        {
            ValidatePath(entry.FullName);
            var kind = entry.ExternalAttributes >> 16 & 0xF000;
            if (kind is not (0 or 0x8000) || !entries.TryAdd(entry.FullName, entry))
                throw new InvalidDataException("Linked or duplicate module entry.");
            total = checked(total + entry.Length);
            if (entry.Length > MaxBytes || total > MaxBytes) throw new InvalidDataException("Expanded module size exceeds bounds.");
        }
        async Task<byte[]> Read(string name, int limit)
        {
            if (!entries.TryGetValue(name, out var entry) || entry.FullName != name || entry.Length > limit)
                throw new InvalidDataException("Missing or oversized module metadata.");
            using var output = new MemoryStream(); await using var stream = entry.Open();
            var buffer = new byte[8192]; int count;
            while ((count = await stream.ReadAsync(buffer, ct)) > 0)
            {
                if (output.Length + count > limit) throw new InvalidDataException("Module metadata exceeds bounds.");
                output.Write(buffer, 0, count);
            }
            return output.ToArray();
        }
        var bytes = await Read("app.json", 262144);
        var signature = await Read("app.sig", 1024);
        UpdateClient.VerifyManifest(bytes, signature, key);
        using (var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 16 }))
            RejectDuplicates(document.RootElement);
        var manifest = JsonSerializer.Deserialize<ModuleManifest>(bytes, Json) ?? throw new InvalidDataException("Missing module manifest.");
        if (manifest.SchemaVersion != 1 || manifest.Repository != repository || !UpdateClient.IsValidRepository(repository) ||
            !IdPattern().IsMatch(manifest.Id ?? "") || !Version.TryParse(manifest.Version, out var version) ||
            version.Revision != -1 || version.Build < 0 || manifest.HostApi != HostApi || manifest.EngineProtocol != EngineProtocol ||
            manifest.DataFormat < 1 || manifest.Runtime != "node24" || manifest.Platforms is null || manifest.Platforms.Length > 16 || !manifest.Platforms.Contains(rid) ||
            manifest.Files is null || manifest.Files.Length != entries.Count - 2 || manifest.ModelVersion?.Length > 160)
            throw new InvalidDataException("Incompatible module identity, source, protocol or platform.");
        var declared = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in manifest.Files)
        {
            if (file is null) throw new InvalidDataException("Null module file entry.");
            ValidatePath(file.Path);
            if (file.Path is "app.json" or "app.sig" || !declared.Add(file.Path) ||
                !entries.TryGetValue(file.Path, out var entry) || entry.FullName != file.Path ||
                file.Size < 0 || file.Size != entry.Length || !HashPattern().IsMatch(file.Sha256 ?? ""))
                throw new InvalidDataException("Module file table mismatch.");
            await using var stream = entry.Open();
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = new byte[65536]; long actual = 0; int count;
            while ((count = await stream.ReadAsync(buffer, ct)) > 0)
            {
                actual += count; if (actual > file.Size) throw new InvalidDataException("Module file size mismatch.");
                hash.AppendData(buffer, 0, count);
            }
            if (actual != file.Size || !Convert.ToHexString(hash.GetHashAndReset()).Equals(file.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Module file hash mismatch.");
        }
        ValidatePath(manifest.Engine);
        if (!manifest.Engine.StartsWith("engine/", StringComparison.Ordinal) || !manifest.Engine.EndsWith(".mjs", StringComparison.Ordinal) || !manifest.Files.Any(f => f.Path == manifest.Engine))
            throw new InvalidDataException("Invalid module engine entrypoint.");
        if (manifest.Ui is not null)
        {
            ValidatePath(manifest.Ui);
            if (!manifest.Ui.StartsWith("ui/", StringComparison.Ordinal) || !manifest.Ui.EndsWith(".html", StringComparison.Ordinal) || !manifest.Files.Any(f => f.Path == manifest.Ui))
                throw new InvalidDataException("Invalid module UI entrypoint.");
        }
        return new(manifest, packageHash);
    }

    private static void RejectDuplicates(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in value.EnumerateObject())
            {
                if (!keys.Add(property.Name)) throw new InvalidDataException("Duplicate module metadata property.");
                RejectDuplicates(property.Value);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array)
            foreach (var item in value.EnumerateArray()) RejectDuplicates(item);
    }

    internal static void ValidatePath(string path)
    {
        if (string.IsNullOrEmpty(path) || path.Length > 240 || path.Contains('\\') || path.Contains(':') || path.StartsWith('/') ||
            path.Any(char.IsControl) || path.Split('/').Any(p => p is "" or "." or ".." || p.EndsWith('.') || p.EndsWith(' ') ||
                p.IndexOfAny(['<', '>', '"', '|', '?', '*']) >= 0 || DevicePattern().IsMatch(p)))
            throw new InvalidDataException("Unsafe module path.");
    }
    [GeneratedRegex("^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$", RegexOptions.CultureInvariant)]
    private static partial Regex IdPattern();
    [GeneratedRegex("^[a-fA-F0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex HashPattern();
    [GeneratedRegex("^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\\.|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex DevicePattern();
}
