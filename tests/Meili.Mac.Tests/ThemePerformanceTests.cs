using System.Diagnostics;
using System.Text.Json;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Meili.Core.Settings;
using Meili.Mac.Platform;
namespace Meili.Mac.Tests;

public sealed class ThemePerformanceTests
{
    [AvaloniaFact] public void Theme_palettes_are_reused_and_no_op_changes_do_not_notify_consumers()
    {
        MacHost.EnsureComposed(); var theme = AppServices.Get<MacTheme>(); theme.Apply(AppThemeMode.Light);
        var light = Ui.Platform.Resource("CardBackgroundFillColorDefaultBrush"); var count = Avalonia.Application.Current!.Resources.MergedDictionaries.Count;
        var events = 0; EventHandler handler = (_, _) => events++; MacTheme.ColorsChanged += handler;
        try
        {
            theme.Apply(AppThemeMode.Light); Assert.Equal(0, events);
            theme.Apply(AppThemeMode.Dark); theme.Apply(AppThemeMode.Light); Assert.Equal(2, events);
            Assert.Same(light, Ui.Platform.Resource("CardBackgroundFillColorDefaultBrush"));
            Assert.Equal(count, Avalonia.Application.Current!.Resources.MergedDictionaries.Count);
        }
        finally { MacTheme.ColorsChanged -= handler; theme.Apply(AppThemeMode.System); }
    }

    [AvaloniaFact] public void Warm_theme_switches_preserve_pages_and_do_not_fetch_market_data()
    {
        MacHost.EnsureComposed(); var theme = AppServices.Get<MacTheme>();
        var window = new MainWindow { Width = 1920, Height = 1080 }; window.Show();
        try
        {
            foreach (var page in MainWindow.PageOrder) { window.Navigate(page); MacHost.Pump(); }
            window.Navigate(AppPage.Settings); MacHost.Pump();
            theme.Apply(AppThemeMode.Light); MacHost.Pump();
            var retained = window.CurrentView; var quotes = MacHost.Data.QuoteCalls; var bars = MacHost.Data.BarRequests.Count;
            var apply = new List<double>(); var frame = new List<double>();
            for (var i = 0; i < 12; i++)
            {
                var timer = Stopwatch.StartNew(); theme.Apply(i % 2 == 0 ? AppThemeMode.Dark : AppThemeMode.Light);
                apply.Add(timer.Elapsed.TotalMilliseconds); MacHost.Pump(); frame.Add(timer.Elapsed.TotalMilliseconds);
                Assert.Same(retained, window.CurrentView);
            }
            Assert.Equal(quotes, MacHost.Data.QuoteCalls); Assert.Equal(bars, MacHost.Data.BarRequests.Count);
            if (Environment.GetEnvironmentVariable("MEILI_THEME_PROFILE") is { Length: > 0 } path)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
                File.WriteAllText(path, JsonSerializer.Serialize(new { applyMs = apply, frameMs = frame, medianApplyMs = apply.Order().ElementAt(apply.Count/2), medianFrameMs = frame.Order().ElementAt(frame.Count/2) }, new JsonSerializerOptions { WriteIndented = true }));
            }
            theme.Apply(AppThemeMode.Dark); MacHost.Pump(); MacHost.Save(window, "theme-fast-dark-1080p");
            theme.Apply(AppThemeMode.Light); MacHost.Pump(); MacHost.Save(window, "theme-fast-light-1080p");
        }
        finally { window.Close(); theme.Apply(AppThemeMode.System); }
    }
}
