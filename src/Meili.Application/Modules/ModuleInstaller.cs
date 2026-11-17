using System.Security.Cryptography;
using System.Text.Json;
using Meili.Core.Settings;

namespace Meili.Automation.Modules;

public sealed record ModuleMaintenanceResult(string Status, string Id, string? Version, bool DataPreserved = true);

/// <summary>Explicit local maintenance. Never registered as a business or MCP operation.</summary>
public sealed class ModuleInstaller
{
    private readonly ModuleRegistry registry;
    private readonly Func<string, CancellationToken, Task<VerifiedModule>> verify;
    public ModuleInstaller(string directory) : this(directory, ModulePackage.VerifyAsync) { }
    internal ModuleInstaller(string directory, Func<string, CancellationToken, Task<VerifiedModule>> verify)
    { registry = new(directory); this.verify = verify; }
    public ModuleRegistrySnapshot Inspect() => registry.Read();

    /// <summary>Reconciles interrupted metadata transactions; never activates a candidate or rewinds user data.</summary>
    public int RecoverPending()
    {
        registry.CheckRoot(); var folder = PathFolder(false, "transactions");
        if (!Directory.Exists(folder)) return 0;
        var recovered = 0;
        foreach (var path in Directory.EnumerateFiles(folder, "*.json").Order(StringComparer.Ordinal).Take(256))
        {
            RejectLink(path);
            if (new FileInfo(path).Length > 8192) throw new InvalidDataException("Oversized module transaction.");
            var file = new SnapshotFile(path); var text = file.Read();
            if (text is null) continue;
            using var document = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 8 });
            var value = document.RootElement;
            var phase = value.GetProperty("phase").GetString();
            if (phase is "activated" or "reconciled_active" or "abandoned") continue;
            if (value.GetProperty("schemaVersion").GetInt32() != 1 || phase is not ("verified" or "staged"))
                throw new InvalidDataException("Unknown module transaction.");
            var id = value.GetProperty("id").GetString()!; ModuleRegistry.ValidateId(id);
            IDisposable lease;
            try { lease = registry.AcquireMaintenance(id); }
            catch (IOException) { continue; /* A real operation/installer still owns this app. */ }
            using (lease)
            {
                var active = registry.Read().State.Apps.SingleOrDefault(a => a.Id == id);
                var matches = active is not null && active.Version == value.GetProperty("version").GetString() &&
                    active.PackageSha256 == value.GetProperty("packageSha256").GetString();
                var record = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(text)!;
                record["phase"] = JsonSerializer.SerializeToElement(matches ? "reconciled_active" : "abandoned");
                file.Write(JsonSerializer.Serialize(record)); recovered++;
            }
        }
        return recovered;
    }

    public async Task<ModuleMaintenanceResult> InstallAsync(string archive, CancellationToken ct = default, bool updateOnly = false)
    {
        var source = await verify(archive, ct);
        ModuleRegistry.ValidateId(source.Manifest.Id);
        registry.CheckRoot();
        var stagingRoot = Folder("staging");
        var stage = Path.Combine(stagingRoot, Guid.NewGuid().ToString("N")); Directory.CreateDirectory(stage);
        var copied = Path.Combine(stage, "package.espapp");
        try
        {
            await using (var input = new FileStream(archive, FileMode.Open, FileAccess.Read, FileShare.Read))
            await using (var output = new FileStream(copied, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                await input.CopyToAsync(output, ct);
            var candidate = await verify(copied, ct);
            if (candidate.PackageSha256 != source.PackageSha256) throw new InvalidDataException("Module changed while staging.");
            var candidateOperations = ModuleOperations.ReadPackage(candidate, copied);
            RecoverPending();
            using var maintenance = registry.AcquireMaintenance(candidate.Manifest.Id);
            var snapshot = registry.Read();
            var existing = snapshot.State.Apps.SingleOrDefault(a => a.Id == candidate.Manifest.Id);
            if (updateOnly && existing is null) throw new ArgumentException("Module must be installed before updating.");
            if (existing is not null && (Version.Parse(existing.Version) > Version.Parse(candidate.Manifest.Version) ||
                existing.DataFormat != candidate.Manifest.DataFormat))
                throw new InvalidDataException("Module downgrade or incompatible data migration requires a separate verified plan.");
            if (existing is not null)
            {
                var previousPath = Path.Combine(registry.Root, "packages", existing.Id, existing.Version, "package.espapp");
                var previous = await verify(previousPath, ct);
                if (previous.PackageSha256 != existing.PackageSha256) throw new InvalidDataException("Active module package changed.");
                foreach (var old in ModuleOperations.ReadPackage(previous, previousPath))
                {
                    var next = candidateOperations.SingleOrDefault(o => o.Definition.Name == old.Definition.Name);
                    if (next is null || next.Definition.Writes != old.Definition.Writes || !JsonElement.DeepEquals(next.Definition.Schema, old.Definition.Schema))
                        throw new InvalidDataException("Breaking operation changes require a new public operation name.");
                }
            }
            var targetParent = Folder("packages", candidate.Manifest.Id);
            var target = Path.Combine(targetParent, candidate.Manifest.Version);
            var transactions = Folder("transactions");
            var journal = new SnapshotFile(Path.Combine(transactions, Guid.NewGuid().ToString("N") + ".json"));
            void Record(string phase) => journal.Write(JsonSerializer.Serialize(new
            { schemaVersion = 1, candidate.Manifest.Id, candidate.Manifest.Version, candidate.PackageSha256,
                previousVersion = existing?.Version, phase }, WireJson.Options));
            ct.ThrowIfCancellationRequested(); Record("verified");
            if (Directory.Exists(target))
            {
                RejectLink(target);
                var installed = await verify(Path.Combine(target, "package.espapp"), ct);
                if (installed.PackageSha256 != candidate.PackageSha256) throw new InvalidDataException("Existing module version has different contents.");
            }
            else Directory.Move(stage, target);
            Record("staged"); ct.ThrowIfCancellationRequested();
            var app = new InstalledModule(candidate.Manifest.Id, candidate.Manifest.Version, candidate.PackageSha256,
                candidate.Manifest.DataFormat, true, candidate.Manifest.Ui is not null);
            registry.Save(snapshot.Revision, snapshot.State.Apps.Where(a => a.Id != app.Id).Append(app).ToArray(), (snapshot.State.SuppressedSeeds ?? []).Where(id => id != app.Id).ToArray());
            try { Record("activated"); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { Meili.Core.Diagnostics.AppLog.Warn("modules", "Module registry committed; journal completion deferred", ex); }
            return new("installed", app.Id, app.Version);
        }
        finally { if (Directory.Exists(stage)) Directory.Delete(stage, true); }
    }

    public async Task<ModuleMaintenanceResult> SetEnabledAsync(string id, bool enabled, CancellationToken ct = default)
    {
        using var lease = registry.AcquireMaintenance(id);
        var snapshot = registry.Read(); var app = snapshot.State.Apps.SingleOrDefault(a => a.Id == id)
            ?? throw new ArgumentException("Module is not installed.");
        if (enabled)
        {
            var archive=Path.Combine(PathFolder(false,"packages",app.Id),app.Version,"package.espapp");RejectLink(archive);
            var verified=await verify(archive,ct).ConfigureAwait(false);
            if(verified.Manifest.Id!=app.Id||verified.Manifest.Version!=app.Version||verified.PackageSha256!=app.PackageSha256||verified.Manifest.DataFormat!=app.DataFormat)
                throw new InvalidDataException("Module must pass verification before enabling.");
            _=ModuleOperations.ReadPackage(verified,archive);
        }
        registry.Save(snapshot.Revision, snapshot.State.Apps.Select(a => a.Id == id ? a with { Enabled = enabled } : a).ToArray());
        return new(enabled ? "enabled" : "disabled", id, app.Version);
    }

    public ModuleMaintenanceResult Uninstall(string id)
    {
        using var lease = registry.AcquireMaintenance(id);
        var snapshot = registry.Read(); var app = snapshot.State.Apps.SingleOrDefault(a => a.Id == id)
            ?? throw new ArgumentException("Module is not installed.");
        registry.Save(snapshot.Revision, snapshot.State.Apps.Where(a => a.Id != id).ToArray(), (snapshot.State.SuppressedSeeds ?? []).Append(id).Distinct(StringComparer.Ordinal).ToArray());
        // Keep immutable package backups and app data. Garbage collection is separate from unregistering code.
        return new("uninstalled", id, app.Version);
    }

    public async Task<VerifiedModule> VerifyInstalledAsync(string id, CancellationToken ct = default)
    {
        ModuleRegistry.ValidateId(id);
        var app = registry.Read().State.Apps.SingleOrDefault(a => a.Id == id && a.Enabled)
            ?? throw new ArgumentException("Module is not installed or enabled.");
        var folder = PathFolder(false, "packages", app.Id); var version = Path.Combine(folder, app.Version); RejectLink(version);
        var archive = Path.Combine(version, "package.espapp"); RejectLink(archive);
        var verified = await verify(archive, ct);
        if (verified.Manifest.Id != app.Id || verified.Manifest.Version != app.Version ||
            verified.Manifest.DataFormat != app.DataFormat || verified.PackageSha256 != app.PackageSha256)
            throw new InvalidDataException("Installed module no longer matches its registry.");
        return verified;
    }

    private string Folder(params string[] parts) => PathFolder(true, parts);
    private string PathFolder(bool create, params string[] parts)
    {
        registry.CheckRoot(); var current = registry.Root;
        foreach (var part in parts)
        {
            ModulePackage.ValidatePath(part); current = Path.Combine(current, part); RejectLink(current);
            if (create) Directory.CreateDirectory(current);
        }
        return current;
    }
    private static void RejectLink(string path)
    {
        if ((File.Exists(path) || Directory.Exists(path)) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("Linked module installation path.");
    }
}
