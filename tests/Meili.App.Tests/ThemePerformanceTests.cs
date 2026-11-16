using System.Windows;
using Meili.App.Services;
using Meili.Core.Settings;
namespace Meili.App.Tests;
public sealed class ThemePerformanceTests
{
    [Fact] public void Palettes_are_cached_without_growing_application_resources_or_republishing_identical_colors()
    {
        WpfHost.Run(() =>
        {
            var theme = AppServices.Get<ThemeService>(); theme.Apply(AppThemeMode.Light);
            var light = Application.Current.FindResource("CardBackgroundFillColorDefaultBrush");
            var count = Application.Current.Resources.MergedDictionaries.Count;
            var notifications = 0; EventHandler handler = (_, _) => notifications++; ThemeService.ColorsChanged += handler;
            try
            {
                ThemeService.ApplySemanticColors(false); theme.Apply(AppThemeMode.Light); Assert.Equal(0, notifications);
                theme.Apply(AppThemeMode.Dark); theme.Apply(AppThemeMode.Light);
                Assert.Equal(2, notifications); Assert.Same(light, Application.Current.FindResource("CardBackgroundFillColorDefaultBrush"));
                Assert.Equal(count, Application.Current.Resources.MergedDictionaries.Count);
            }
            finally { ThemeService.ColorsChanged -= handler; theme.Apply(AppThemeMode.Dark); }
        });
    }
}
