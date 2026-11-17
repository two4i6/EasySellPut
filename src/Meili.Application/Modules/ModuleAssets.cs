using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using Meili.Core.Settings;

namespace Meili.Automation.Modules;

public sealed class ModuleAssetLease : IDisposable
{
    private readonly byte[] bytes;
    private readonly IDisposable lease;
    private readonly string executionDirectory;
    public string Version { get; }
    internal ModuleAssetLease(byte[] bytes, string version, IDisposable lease, string executionDirectory)
    { this.bytes = bytes; Version = version; this.lease = lease; this.executionDirectory = executionDirectory; }
    public Stream OpenRead() => new MemoryStream(bytes, writable: false);
    internal async Task<string> MaterializeScriptAsync(CancellationToken ct)
    {
        var hash = Convert.ToHexString(SHA256.HashData(bytes));
        var current = new DirectoryInfo(executionDirectory);
        for (var parent = current; parent is not null; parent = parent.Parent)
            if (parent.Exists && parent.LinkTarget is not null) throw new InvalidDataException("Linked module execution directory.");
        Directory.CreateDirectory(executionDirectory);
        var path = Path.Combine(executionDirectory, hash + ".mjs");
        if (File.Exists(path) && new FileInfo(path).LinkTarget is not null) throw new InvalidDataException("Linked module script.");
        if (!File.Exists(path))
        {
            ct.ThrowIfCancellationRequested();
            try { var file = new SnapshotFile(path); if (file.Read() is null) file.Write(new UTF8Encoding(false, true).GetString(bytes)); }
            catch (DataConflictException) when (File.Exists(path)) { /* Another owner materialized the same content. */ }
        }
        if (!SHA256.HashData(await File.ReadAllBytesAsync(path, ct)).SequenceEqual(SHA256.HashData(bytes)))
            throw new InvalidDataException("Materialized module script was modified.");
        return path;
    }
    public void Dispose() => lease.Dispose();
}

/// <summary>Reads only signed declared assets while holding a real execution lease.</summary>
public static class ModuleAssets
{
    public static Task<ModuleAssetLease?> TryOpenAsync(string directory, string id, string asset, CancellationToken ct = default) =>
        TryOpenAsync(directory, id, asset, new ModuleInstaller(directory), ct);

    internal static async Task<ModuleAssetLease?> TryOpenAsync(string directory, string id, string asset, ModuleInstaller installer, CancellationToken ct)
    {
        ModuleRegistry.ValidateId(id); ModulePackage.ValidatePath(asset);
        var registry = new ModuleRegistry(directory);
        if (!registry.Read().State.Apps.Any(a => a.Id == id)) return null;
        var lease = registry.AcquireExecution(id);
        try
        {
            if (!registry.Read().State.Apps.Any(a => a.Id == id && a.Enabled))
                throw new InvalidOperationException("Application is disabled or no longer installed.");
            var verified = await installer.VerifyInstalledAsync(id, ct);
            var file = verified.Manifest.Files.SingleOrDefault(f => f.Path == asset)
                ?? throw new InvalidDataException("Asset is not declared by this module version.");
            if (file.Size > 64 * 1024 * 1024) throw new InvalidDataException("Module asset exceeds read bound.");
            var archive = Path.Combine(registry.Root, "packages", id, verified.Manifest.Version, "package.espapp");
            using var zip = ZipFile.OpenRead(archive);
            var entry = zip.GetEntry(asset) ?? throw new InvalidDataException("Module asset is missing.");
            using var output = new MemoryStream(); await using var input = entry.Open();
            var buffer = new byte[65536]; int count;
            while ((count = await input.ReadAsync(buffer, ct)) > 0)
            {
                if (output.Length + count > file.Size) throw new InvalidDataException("Module asset length changed.");
                output.Write(buffer, 0, count);
            }
            var bytes = output.ToArray();
            if (bytes.LongLength != file.Size || !Convert.ToHexString(SHA256.HashData(bytes)).Equals(file.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Module asset changed after verification.");
            return new(bytes, verified.Manifest.Version, lease, Path.Combine(registry.Root, "execution", id, verified.Manifest.Version));
        }
        catch { lease.Dispose(); throw; }
    }
}
