using System.Text.Json;
namespace Meili.Automation.Modules;

/// <summary>Typed, bounded read-only host capabilities; never arbitrary dispatcher or maintenance access.</summary>
public static class ModuleHostOperations
{
    private static readonly HashSet<string> Names=new(StringComparer.Ordinal)
    {"get_quotes","get_bars","get_expirations","get_option_chain","calculate_option","calculate_indicators","analyze_strategy"};
    internal static void Validate(IReadOnlyList<string>? names)
    {
        if(names is null)return;
        if(names.Count is <1 or >7||names.Distinct(StringComparer.Ordinal).Count()!=names.Count||names.Any(name=>!Names.Contains(name)))
            throw new InvalidDataException("Unsupported or duplicate host capability.");
    }
    internal static Operation Definition(string name)
    {
        if(!Names.Contains(name))throw new UnauthorizedAccessException("Application host capability is not available.");
        return OperationCatalog.All.Single(o=>o.Name==name&&!o.Writes);
    }
    internal static bool Equivalent(IReadOnlyList<string>? left,IReadOnlyList<string>? right)=>
        (left??[]).Order(StringComparer.Ordinal).SequenceEqual((right??[]).Order(StringComparer.Ordinal));
}
