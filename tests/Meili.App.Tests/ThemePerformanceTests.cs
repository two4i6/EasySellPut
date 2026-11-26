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
    [Fact] public void Explicit_theme_reestablishes_semantics_when_the_framework_theme_already_matches()
    {
        WpfHost.Run(()=>
        {
            var theme=AppServices.Get<ThemeService>();
            try{
                theme.Apply(AppThemeMode.Light);var expected=Application.Current.FindResource("CardBackgroundFillColorDefaultBrush");
                ThemeService.ApplySemanticColors(true); // Framework remains Light: no Changed event is required.
                theme.Apply(AppThemeMode.Light);
                Assert.Same(expected,Application.Current.FindResource("CardBackgroundFillColorDefaultBrush"));
                var notifications=0;EventHandler handler=(_,_)=>notifications++;ThemeService.ColorsChanged+=handler;
                var unrelated=new ResourceDictionary{{"ThemeTestMarker",true}};
                try{
                    Application.Current.Resources.MergedDictionaries.Add(unrelated);
                    ThemeService.ApplySemanticColors(false);Assert.Equal(0,notifications);
                    Assert.Same(expected,Application.Current.FindResource("CardBackgroundFillColorDefaultBrush"));
                }
                finally{Application.Current.Resources.MergedDictionaries.Remove(unrelated);ThemeService.ColorsChanged-=handler;}
            }
            finally{theme.Apply(AppThemeMode.Dark);}
        });
    }

}
