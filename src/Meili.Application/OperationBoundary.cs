using System.Collections.ObjectModel;
using System.Text.Json;
using Meili.Core.Settings;

namespace Meili.Automation;

/// <summary>A stable, UI-free discovery snapshot. It does not activate code or grant permissions.</summary>
public sealed record OperationCatalogIssue(string? AppId,string Code,string Message);

public interface IOperationCatalog
{
    IReadOnlyList<OperationCatalogIssue> Issues=>Array.Empty<OperationCatalogIssue>();
    IReadOnlyList<Operation> All { get; }
    Operation Find(string name);
}

/// <summary>Metadata-only profile discovery; never starts providers, engines or storage migrations.</summary>
public static class OperationCatalogResolver
{
    public static async Task<IOperationCatalog> ResolveAsync(DataDirectoryInfo directory, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(directory);
        var discovery=await Modules.ModuleOperations.ReadSnapshotAsync(directory.Path,ct).ConfigureAwait(false);
        var catalog=discovery.Operations.Count==0&&discovery.Issues.Count==0?OperationCatalog.Snapshot:Modules.ModuleOperations.Merge(discovery.Operations,discovery.Issues);
        var active=discovery.State?.Apps.SingleOrDefault(app=>app.Id==Modules.ModuleAccess.QqqGex);
        var enabled=discovery.State is not null&&(active?.Enabled??!((discovery.State.SuppressedSeeds??[]).Contains(Modules.ModuleAccess.QqqGex)))&&
            !discovery.Issues.Any(issue=>issue.AppId==Modules.ModuleAccess.QqqGex);
        return enabled?catalog:new OperationSnapshot(catalog.All.Where(operation=>!Apps.QqqGex.GexContracts.All.Any(seed=>seed.Name==operation.Name)),discovery.Issues);
    }
}

public sealed class OperationSnapshot : IOperationCatalog
{
    private readonly ReadOnlyCollection<Operation> operations;
    private readonly IReadOnlyDictionary<string, Operation> names;

    public IReadOnlyList<OperationCatalogIssue> Issues {get;}

    public OperationSnapshot(IEnumerable<Operation> source,IEnumerable<OperationCatalogIssue>? issues=null)
    {
        ArgumentNullException.ThrowIfNull(source);
        Issues=Array.AsReadOnly((issues??[]).ToArray());
        var copy = source.Select(o => o with { Schema = o.Schema.Clone() }).ToArray();
        if (copy.Any(o => string.IsNullOrWhiteSpace(o.Name)) ||
            copy.Select(o => o.Name).Distinct(StringComparer.Ordinal).Count() != copy.Length)
            throw new ArgumentException("Operation names must be nonempty and unique.", nameof(source));
        operations = Array.AsReadOnly(copy);
        names = copy.ToDictionary(o => o.Name, StringComparer.Ordinal);
    }

    public IReadOnlyList<Operation> All => operations;
    public Operation Find(string name)
    {
        if(names.TryGetValue(name,out var operation))return operation;
        foreach(var issue in Issues)
        {
            var appName=issue.AppId is null?name.StartsWith("app_",StringComparison.Ordinal)||name.Contains("_qqq_gex_",StringComparison.Ordinal):
                issue.AppId==Modules.ModuleAccess.QqqGex?name.Contains("_qqq_gex_",StringComparison.Ordinal):name.StartsWith("app_"+issue.AppId.Replace('.','_').Replace('-','_')+"_",StringComparison.Ordinal);
            if(appName)throw new Modules.AppUnavailableException(issue.AppId??"registry");
        }
        throw new ArgumentException($"Unknown operation: {name}");
    }
}

/// <summary>Transport-independent application entry point; discovery and execution share one catalog.</summary>
public interface IOperationDispatcher : IDisposable
{
    DataDirectoryInfo DirectoryInfo { get; }
    Task<IOperationCatalog> GetCatalogAsync(CancellationToken ct = default);
    Task<JsonElement> ExecuteAsync(string operation, JsonElement arguments, bool allowWrites, CancellationToken ct = default);
}
