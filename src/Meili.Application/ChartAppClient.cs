using Meili.Automation.Modules;
namespace Meili.Shared.Services;
/// <summary>Full native chart receipts, indicators, live stitching and gestures share a verified active domain lease.</summary>
public sealed class ChartAppClient
{
    private readonly string directory;
    private readonly ModuleInstaller installer;
    private readonly ModuleFacadeClient facade;

    public ChartAppClient(string directory) : this(directory, new ModuleInstaller(directory)) { }

    internal ChartAppClient(string directory, ModuleInstaller installer)
    {
        this.directory = directory;
        this.installer = installer;
        facade = new(directory, ModuleAccess.Charts);
    }

    internal async Task<IReadOnlyDictionary<string, byte[]>?> ReadRendererAsync(CancellationToken ct)
    {
        using var lease = ModuleAccess.AcquireEnabled(directory, ModuleAccess.Charts);
        var registry = new ModuleRegistry(directory);
        if (!registry.Read().State.Apps.Any(app => app.Id == ModuleAccess.Charts))
            return null; // Built-in compatibility renderer.
        var installed = await installer.VerifyInstalledAsync(ModuleAccess.Charts, ct).ConfigureAwait(false);
        if (installed.Manifest.Ui is null)
            return null; // Legacy signed core-only package.
        if (installed.Manifest.Ui != "ui/index.html")
            throw new InvalidDataException("Unsupported chart renderer entrypoint.");

        var assets = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        foreach (var name in new[] { "index.html", "chart.js", "chart.css" })
        {
            using var asset = await ModuleAssets.TryOpenAsync(directory, ModuleAccess.Charts, "ui/" + name, installer, ct).ConfigureAwait(false)
                ?? throw new InvalidDataException("Chart renderer asset unavailable.");
            using var stream = asset.OpenRead();
            using var bytes = new MemoryStream();
            await stream.CopyToAsync(bytes, ct).ConfigureAwait(false);
            assets.Add(name, bytes.ToArray());
        }
        return assets;
    }

    public Task<IDisposable> AcquireAsync(CancellationToken ct)=>facade.AcquireDomainAsync(ct);
}
