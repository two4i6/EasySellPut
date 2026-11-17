using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Meili.Core.Settings;

namespace Meili.Automation.Modules;

public sealed record InstalledModule(string Id, string Version, string PackageSha256, int DataFormat, bool Enabled, bool? HasUi = null);
public sealed record ModuleRegistryState(int SchemaVersion, long Generation, InstalledModule[] Apps, string[]? SuppressedSeeds = null);
public sealed record ModuleRegistrySnapshot(ModuleRegistryState State, string Revision);

/// <summary>Profile metadata with optimistic cross-process writes. Metadata alone never authorizes code execution.</summary>
public sealed class ModuleRegistry
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    public string Root { get; }
    private string FileName => Path.Combine(Root, "registry.json");
    public ModuleRegistry(string dataDirectory) => Root = Path.Combine(Path.GetFullPath(dataDirectory), "apps");

    public ModuleRegistrySnapshot Read()
    {
        CheckRoot();
        if (File.Exists(FileName) && (new FileInfo(FileName).Length > 1048576 || new FileInfo(FileName).LinkTarget is not null))
            throw new InvalidDataException("Unsafe module registry.");
        var text = new SnapshotFile(FileName).Read();
        var state = text is null ? new ModuleRegistryState(1, 0, []) : JsonSerializer.Deserialize<ModuleRegistryState>(text, Json)
            ?? throw new InvalidDataException("Invalid module registry.");
        Validate(state);
        return new(state, Revision(text));
    }

    internal ModuleRegistrySnapshot Save(string expectedRevision, IReadOnlyList<InstalledModule> apps, IReadOnlyList<string>? suppressedSeeds = null)
    {
        CheckRoot();
        var file = new SnapshotFile(FileName); var text = file.Read();
        if (Revision(text) != expectedRevision) throw new DataConflictException(FileName);
        var current = text is null ? new ModuleRegistryState(1, 0, []) : JsonSerializer.Deserialize<ModuleRegistryState>(text, Json)
            ?? throw new InvalidDataException("Invalid module registry.");
        Validate(current);
        var state = new ModuleRegistryState(1, checked(current.Generation + 1), apps.ToArray(), (suppressedSeeds ?? current.SuppressedSeeds ?? []).ToArray()); Validate(state);
        file.Write(JsonSerializer.Serialize(state, Json));
        return Read();
    }

    /// <summary>Held for actual app use only, never for an idle MCP transport.</summary>
    public IDisposable AcquireExecution(string appId) => Acquire(appId, exclusive: false);
    internal IDisposable AcquireMaintenance(string appId) => Acquire(appId, exclusive: true);
    internal IDisposable AcquireJob(string appId) => Acquire(appId, exclusive: true, folderName: "jobs");
    private IDisposable Acquire(string appId, bool exclusive, string folderName = "leases")
    {
        ValidateId(appId); CheckRoot();
        var folder = Path.Combine(Root, folderName);
        if (Directory.Exists(folder) && (File.GetAttributes(folder) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("Linked module lease folder.");
        Directory.CreateDirectory(folder);
        var name = Path.Combine(folder, appId + ".lease");
        if (File.Exists(name) && new FileInfo(name).LinkTarget is not null) throw new InvalidDataException("Linked module lease.");
        if (!File.Exists(name))
        {
            try { using var created = new FileStream(name, FileMode.CreateNew, FileAccess.Write, FileShare.ReadWrite); }
            catch (IOException) when (File.Exists(name)) { /* Another owner created the shared lock file first. */ }
        }
        return new FileStream(name, FileMode.Open, exclusive ? FileAccess.ReadWrite : FileAccess.Read,
            exclusive ? FileShare.None : FileShare.Read);
    }

    internal void CheckRoot()
    {
        if (Directory.Exists(Root) && (File.GetAttributes(Root) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("Linked module root.");
    }
    internal static void ValidateId(string id)
    {
        if (string.IsNullOrEmpty(id) || id.Length > 100 || id[0] is < 'a' or > 'z' ||
            !id.Contains('.') || id.Any(c => !(c is >= 'a' and <= 'z' or >= '0' and <= '9' or '.' or '-')) ||
            id.Split('.').Any(p => p.Length == 0)) throw new InvalidDataException("Invalid module identity.");
    }
    private static void Validate(ModuleRegistryState state)
    {
        if (state.SchemaVersion != 1 || state.Generation < 0 || state.Apps is null || state.Apps.Length > 64 ||
            state.Apps.Select(a => a?.Id).Distinct(StringComparer.Ordinal).Count() != state.Apps.Length)
            throw new InvalidDataException("Invalid module registry state.");
        var suppressed = state.SuppressedSeeds ?? [];
        if (suppressed.Length > 256 || suppressed.Distinct(StringComparer.Ordinal).Count() != suppressed.Length) throw new InvalidDataException("Invalid suppressed module seeds.");
        foreach (var id in suppressed) ValidateId(id);
        foreach (var app in state.Apps)
        {
            if (app is null) throw new InvalidDataException("Null module registration.");
            ValidateId(app.Id);
            if (!Version.TryParse(app.Version, out var version) || version.Build < 0 || version.Revision != -1 || version.ToString(3) != app.Version || app.DataFormat < 1 ||
                app.PackageSha256 is null || app.PackageSha256.Length != 64 || app.PackageSha256.Any(c => !char.IsAsciiHexDigit(c)))
                throw new InvalidDataException("Invalid module registration.");
        }
    }
    private static string Revision(string? text) => text is null ? "missing" : Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
}
