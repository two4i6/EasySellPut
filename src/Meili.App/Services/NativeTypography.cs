using System.Windows;
using System.Windows.Documents;

namespace Meili.App;

internal static class NativeTypography
{
    private static ResourceDictionary? _overrides;

    public static void Initialize(int percent)
    {
        DesignTypography.Changed -= OnChanged;
        DesignTypography.Apply(percent);
        ApplyResources();
        DesignTypography.Changed += OnChanged;
    }

    private static void OnChanged(object? sender, EventArgs args) => ApplyResources();

    private static void ApplyResources()
    {
        var dictionaries = Application.Current.Resources.MergedDictionaries;
        var updated = new ResourceDictionary();
        foreach (var (key, size) in DesignTypography.Resources()) updated[key] = size;
        var index = _overrides is null ? -1 : dictionaries.IndexOf(_overrides);
        if (index < 0) dictionaries.Add(updated);
        else dictionaries[index] = updated;
        _overrides = updated;
    }

    public static T WithFontSize<T>(this T control, double baseline) where T : FrameworkElement
    {
        control.SetResourceReference(TextElement.FontSizeProperty, DesignTypography.ResourceKey(baseline));
        return control;
    }
}
