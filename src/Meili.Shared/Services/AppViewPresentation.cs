using System.Text.Json;
using Meili.Automation;
namespace Meili.Shared.Services;
/// <summary>The same live design tokens and language contract used by existing private financial charts.</summary>
public static class AppViewPresentation
{
    public static JsonElement Create(ChartPalette palette)=>WireJson.Element(new{language=LocalizationService.Current.Language,theme=WebChartSnapshot.Theme(palette)});
}
