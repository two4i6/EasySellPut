using System.Text.Json.Nodes;
namespace Meili.Automation.Modules;

/// <summary>Generated canonical design defaults shared by native presentation adapters and the UI-free developer host.</summary>
public static class AppThemeDefaults
{
    private static readonly JsonObject defaults=Read();
    private static JsonObject Read()
    {
        using var resource=typeof(AppThemeDefaults).Assembly.GetManifestResourceStream("EasySellPut.AppThemeDefaults")??throw new InvalidDataException("Missing generated app theme defaults.");
        return JsonNode.Parse(resource)!.AsObject();
    }
    public static JsonObject Create(bool dark,bool reducedMotion=false)
    {
        var result=defaults[dark?"dark":"light"]!.DeepClone().AsObject();result["reducedMotion"]=reducedMotion;return result;
    }
}
