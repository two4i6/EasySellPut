using System.Collections.ObjectModel;
using System.Text.Json;
using Meili.Core.Settings;

namespace Meili.Automation;

/// <summary>A stable, UI-free discovery snapshot. It does not activate code or grant permissions.</summary>
public interface IOperationCatalog
{
    IReadOnlyList<Operation> All { get; }
    Operation Find(string name);
}

/// <summary>Metadata-only profile discovery; never starts providers, engines or storage migrations.</summary>
public static class OperationCatalogResolver
{
    public static IOperationCatalog Resolve(DataDirectoryInfo directory)
    {
        ArgumentNullException.ThrowIfNull(directory);
        var contributions = Task.Run(() => Modules.ModuleOperations.ReadAsync(directory.Path)).GetAwaiter().GetResult();
        return contributions.Count == 0 ? OperationCatalog.Snapshot : Modules.ModuleOperations.Merge(contributions);
    }
}

public sealed class OperationSnapshot : IOperationCatalog
{
    private readonly ReadOnlyCollection<Operation> operations;
    private readonly IReadOnlyDictionary<string, Operation> names;

    public OperationSnapshot(IEnumerable<Operation> source)
    {
        ArgumentNullException.ThrowIfNull(source);
        var copy = source.Select(o => o with { Schema = o.Schema.Clone() }).ToArray();
        if (copy.Any(o => string.IsNullOrWhiteSpace(o.Name)) ||
            copy.Select(o => o.Name).Distinct(StringComparer.Ordinal).Count() != copy.Length)
            throw new ArgumentException("Operation names must be nonempty and unique.", nameof(source));
        operations = Array.AsReadOnly(copy);
        names = copy.ToDictionary(o => o.Name, StringComparer.Ordinal);
    }

    public IReadOnlyList<Operation> All => operations;
    public Operation Find(string name) => names.TryGetValue(name, out var operation)
        ? operation : throw new ArgumentException($"Unknown operation: {name}");
}

/// <summary>Transport-independent application entry point; discovery and execution share one catalog.</summary>
public interface IOperationDispatcher : IDisposable
{
    DataDirectoryInfo DirectoryInfo { get; }
    IOperationCatalog Catalog { get; }
    Task<JsonElement> ExecuteAsync(string operation, JsonElement arguments, bool allowWrites, CancellationToken ct = default);
}
