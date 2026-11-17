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
            if(candidate.Manifest.Id==ModuleAccess.QqqGex&&candidate.Manifest.DataFormat!=1&&File.Exists(Path.Combine(Path.GetDirectoryName(registry.Root)!,"cache","qqq-gex.db")))
                throw new InvalidDataException("Legacy GEX observations require format 1 until a separately verified migration.");
            if(snapshot.State.RetainedFormats?.TryGetValue(candidate.Manifest.Id,out var retainedFormat)==true&&retainedFormat!=candidate.Manifest.DataFormat)
                throw new InvalidDataException("Retained application data require the existing format; uninstall is not a data migration.");
            if (existing is not null && (Version.Parse(existing.Version) > Version.Parse(candidate.Manifest.Version) ||
                existing.DataFormat != candidate.Manifest.DataFormat))
                throw new InvalidDataException("Module downgrade or incompatible data migration requires a separate verified plan.");
            if (existing is not null)
            {
                var previousPath = InstalledArchive(existing);
                VerifiedModule previous;IReadOnlyList<BoundModuleOperation> previousOperations;
                try
                {
                    previous=await verify(previousPath,ct);
                    if(previous.PackageSha256!=existing.PackageSha256)throw new InvalidDataException("Active module package changed.");
                    previousOperations=ModuleOperations.ReadPackage(previous,previousPath);
                }
                catch(Exception ex)when((ex is IOException or InvalidDataException or JsonException or UnauthorizedAccessException)&&candidate.PackageSha256==existing.PackageSha256&&candidate.Manifest.Version==existing.Version)
                {
                    // expected: an explicit install may restore exactly the authenticated archive already recorded.
                    // A different candidate cannot bypass unknown previous permission/schema contracts.
                    previous=candidate;previousOperations=candidateOperations;
                }
                if(existing.Version==candidate.Manifest.Version&&previous.PackageSha256!=candidate.PackageSha256)
                    ValidateUiAttachment(previous.Manifest,candidate.Manifest);
                foreach (var old in previousOperations)
                {
                    var next = candidateOperations.SingleOrDefault(o => o.Definition.Name == old.Definition.Name);
                    if (next is null || next.Definition.Writes != old.Definition.Writes || !ModuleHostOperations.Equivalent(next.Definition.HostOperations,old.Definition.HostOperations) || !JsonElement.DeepEquals(next.Definition.Schema, old.Definition.Schema))
                        throw new InvalidDataException("Breaking operation changes require a new public operation name.");
                }
            }
            var targetParent = Folder("packages", candidate.Manifest.Id, candidate.Manifest.Version);
            var target = Path.Combine(targetParent, candidate.PackageSha256);
            var transactions = Folder("transactions");
            var journal = new SnapshotFile(Path.Combine(transactions, Guid.NewGuid().ToString("N") + ".json"));
            void Record(string phase) => journal.Write(JsonSerializer.Serialize(new
            { schemaVersion = 1, candidate.Manifest.Id, candidate.Manifest.Version, candidate.PackageSha256,
                previousVersion = existing?.Version, phase }, WireJson.Options));
            ct.ThrowIfCancellationRequested(); Record("verified");
            if (Directory.Exists(target))
            {
                RejectLink(target);
                var intact=false;
                try{var installed=await verify(Path.Combine(target,"package.espapp"),ct);intact=installed.PackageSha256==candidate.PackageSha256;}
                catch(Exception ex)when(ex is IOException or InvalidDataException or JsonException or UnauthorizedAccessException)
                { /* expected: authenticated candidate restores this exact hash-addressed object; preserve its corrupt predecessor below. */ }
                if(!intact)
                {
                    var quarantine=Folder("quarantine",candidate.Manifest.Id,candidate.Manifest.Version);
                    Directory.Move(target,Path.Combine(quarantine,candidate.PackageSha256+"."+Guid.NewGuid().ToString("N")));
                    Directory.Move(stage,target);
                }
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
            var archive=InstalledArchive(app);
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
        return await VerifySnapshotAsync(app,ct).ConfigureAwait(false);
    }
    // Discovery authenticates an immutable snapshot without pinning maintenance. Old archives
    // are retained; execution still re-resolves under its own real execution lease.
    internal async Task<VerifiedModule> VerifySnapshotAsync(InstalledModule app,CancellationToken ct)
    {
        var archive = InstalledArchive(app);
        var verified = await verify(archive, ct);
        if (verified.Manifest.Id != app.Id || verified.Manifest.Version != app.Version ||
            verified.Manifest.DataFormat != app.DataFormat || verified.PackageSha256 != app.PackageSha256)
            throw new InvalidDataException("Installed module no longer matches its registry.");
        return verified;
    }

    // Content-addressed variants permit an optional UI to attach to the exact same core release.
    // Existing installations remain readable; fallback never chooses a different package hash.
    internal string InstalledArchive(InstalledModule app)
    {
        ModuleRegistry.ValidateId(app.Id);
        if(!Version.TryParse(app.Version,out var version)||version.ToString(3)!=app.Version||
            app.PackageSha256.Length!=64||!app.PackageSha256.All(Uri.IsHexDigit))throw new InvalidDataException("Unsafe installed package identity.");
        var folder=PathFolder(false,"packages",app.Id,app.Version);
        var variant=Path.Combine(folder,app.PackageSha256);RejectLink(variant);
        var archive=Directory.Exists(variant)?Path.Combine(variant,"package.espapp"):Path.Combine(folder,"package.espapp");
        RejectLink(archive);return archive;
    }
    private static void ValidateUiAttachment(ModuleManifest core,ModuleManifest full)
    {
        if(core.Ui is not null||full.Ui is null||core.Repository!=full.Repository||core.Id!=full.Id||core.Version!=full.Version||
            core.HostApi!=full.HostApi||core.EngineProtocol!=full.EngineProtocol||core.DataFormat!=full.DataFormat||core.Runtime!=full.Runtime||core.Engine!=full.Engine||
            core.ModelVersion!=full.ModelVersion||!core.Platforms.Order(StringComparer.Ordinal).SequenceEqual(full.Platforms.Order(StringComparer.Ordinal)))
            throw new InvalidDataException("Same-version changes may only attach UI to an unchanged core.");
        foreach(var file in core.Files)
            if(!full.Files.Any(next=>next.Path==file.Path&&next.Size==file.Size&&next.Sha256.Equals(file.Sha256,StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException("UI attachment changed existing core content.");
        if(full.Files.Any(file=>!core.Files.Any(old=>old.Path==file.Path)&&!file.Path.StartsWith("ui/",StringComparison.Ordinal)&&!file.Path.StartsWith("notices/",StringComparison.Ordinal)))
            throw new InvalidDataException("UI attachment adds non-UI executable content.");
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
