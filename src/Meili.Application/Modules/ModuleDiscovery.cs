namespace Meili.Automation.Modules;

public sealed record ModuleDiscovery(IReadOnlyList<BoundModuleOperation> Operations,IReadOnlyList<OperationCatalogIssue> Issues,ModuleRegistryState? State)
{
    public void RequireAvailable(string id)
    {
        if(Issues.Any(issue=>issue.AppId is null||issue.AppId==id))throw new AppUnavailableException(id);
    }
}
public sealed class AppUnavailableException(string id):InvalidOperationException($"Application '{id}' is unavailable. Run apps doctor and restore a trusted package; retained data were not removed.");
