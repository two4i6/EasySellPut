namespace Meili.Core.Settings;

/// <summary>Presentation preferences only. Strike and observed bid/ask actions are always retained.</summary>
public static class WorkbenchColumns
{
    public static IReadOnlyList<string> Available { get; } = Array.AsReadOnly(new[] { "Be", "BePercent", "Oi", "Volume", "Iv", "Delta", "Gamma", "Theta", "Vega", "Rho", "Last" });
    public static IReadOnlyList<string> Default { get; } = Array.AsReadOnly(new[] { "Be", "BePercent", "Oi", "Volume", "Iv", "Delta", "Gamma" });
    public static List<string> Normalize(IEnumerable<string>? values) => values is null ? Default.ToList() : Available.Where(values.Contains).ToList();
}
