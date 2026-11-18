using Meili.Automation.Modules;
namespace Meili.Shared.Services;
/// <summary>Full native chart receipts, indicators, live stitching and gestures share a verified active domain lease.</summary>
public sealed class ChartAppClient(string directory)
{
    private readonly ModuleFacadeClient facade=new(directory,ModuleAccess.Charts);
    public Task<IDisposable> AcquireAsync(CancellationToken ct)=>facade.AcquireDomainAsync(ct);
}
