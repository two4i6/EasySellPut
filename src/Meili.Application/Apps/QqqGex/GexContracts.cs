using System.Text.Json;
namespace Meili.Automation.Apps.QqqGex;

/// <summary>App-owned stable facade contracts. Ordinary host compilation embeds metadata only.</summary>
internal static class GexContracts
{
    internal static IReadOnlyList<Operation> All {get;}=Read();
    private static IReadOnlyList<Operation> Read()
    {
        using var resource=typeof(GexContracts).Assembly.GetManifestResourceStream("QqqGexRuntime/public-contracts.json")??throw new InvalidDataException("Missing GEX facade contracts.");
        var definitions=JsonSerializer.Deserialize<Operation[]>(resource,new JsonSerializerOptions(JsonSerializerDefaults.Web){UnmappedMemberHandling=System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,MaxDepth=16})??throw new InvalidDataException("Invalid GEX facade contracts.");
        if(definitions.Any(o=>o is null||!o.Name.Contains("_qqq_gex_",StringComparison.Ordinal)))throw new InvalidDataException("Foreign GEX facade contract.");
        return new OperationSnapshot(definitions).All;
    }
}
