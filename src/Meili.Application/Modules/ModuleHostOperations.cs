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
        if(names.Count is <1 or >10||names.Distinct(StringComparer.Ordinal).Count()!=names.Count||names.Any(name=>!Names.Contains(name)&&name is not ("read_app_snapshot" or "open_market_snapshot" or "read_market_snapshot")))
            throw new InvalidDataException("Unsupported or duplicate host capability.");
    }
    internal static Operation Definition(string name)
    {
        if(name=="open_market_snapshot")return new(name,"Open a request-scoped routed market source snapshot",false,JsonSerializer.SerializeToElement(new{type="object",properties=new{kind=new{type="string",@enum=new[]{"chain","bars"}},symbol=new{type="string",maxLength=16},expiry=new{type="string",maxLength=10},interval=new{type="string",@enum=new[]{"1m","5m","15m","30m","1h","1d","1w","1mo"}},from=new{type="string",maxLength=200},to=new{type="string",maxLength=200}},required=new[]{"kind","symbol"},additionalProperties=false}));
        if(name=="read_market_snapshot")return new(name,"Read bounded bytes from this request's source receipt",false,JsonSerializer.SerializeToElement(new{type="object",properties=new{receipt=new{type="string",maxLength=64},offset=new{type="integer",minimum=0,maximum=128*1024*1024},length=new{type="integer",minimum=1,maximum=1048576}},required=new[]{"receipt","offset"},additionalProperties=false}));
        if(name=="read_app_snapshot")return new(name,"Read an app-scoped logical presentation snapshot",false,JsonSerializer.SerializeToElement(new{type="object",properties=new{key=new{type="string",@enum=new[]{"preferences","desktop"}}},required=new[]{"key"},additionalProperties=false}));
        if(!Names.Contains(name))throw new UnauthorizedAccessException("Application host capability is not available.");
        return OperationCatalog.All.Single(o=>o.Name==name&&!o.Writes);
    }
    internal static bool Equivalent(IReadOnlyList<string>? left,IReadOnlyList<string>? right)=>
        (left??[]).Order(StringComparer.Ordinal).SequenceEqual((right??[]).Order(StringComparer.Ordinal));
}
