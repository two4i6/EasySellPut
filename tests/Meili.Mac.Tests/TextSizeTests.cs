using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Meili.Core.Settings;
using Meili.Mac.Views;
using Meili.Mac.Views.Controls;

namespace Meili.Mac.Tests;

public sealed class TextSizeTests
{
    [AvaloniaFact]
    public async Task Changing_text_size_updates_open_controls_and_keeps_the_narrow_market_pages_usable()
    {
        MacHost.EnsureComposed();
        var store = AppServices.Get<SettingsStore>();
        var original = store.Current.TextSizePercent;
        var originalLanguage = LocalizationService.Current.Language;
        var window = new MainWindow { Width = 980, Height = 620 };
        SettingsViewModel? vm = null;
        try
        {
            LocalizationService.Current.Apply("en-US");
            window.Show();
            window.Navigate(AppPage.Settings);
            MacHost.Pump(10);
            vm = Assert.IsType<SettingsViewModel>(window.CurrentView!.DataContext);
            var picker = window.CurrentView!.GetVisualDescendants().OfType<AppSelect>()
                .Single(select => AutomationProperties.GetAutomationId(select) == "SettingsTextSize");
            Assert.Equal(new[] { "100%", "110%", "125%", "150%" }, picker.Items.Cast<string>());
            picker.SelectedIndex = 0;
            MacHost.Pump(10);
            Assert.Equal(13.5, picker.FontSize);
            MacHost.Save(window, "text-size-settings-standard");
            picker.SelectedIndex = 3;
            MacHost.Pump(10);
            Assert.Equal(150, new SettingsStore(MacHost.DataDir).Load().TextSizePercent);
            Assert.Equal(20.25, picker.FontSize);
            MacHost.Save(window, "text-size-settings-150");

            window.Navigate(AppPage.Charts);
            MacHost.Pump(10);
            var chart = Assert.IsType<ChartsPage>(window.CurrentView);
            var toolbar = chart.FindControl<Grid>("ChartToolbar")!;
            var ranges = chart.FindControl<ItemsControl>("RangeTabs")!;
            Assert.True(toolbar.IsEffectivelyVisible);
            Assert.All(ranges.GetVisualDescendants().OfType<Button>(), button =>
                Assert.True(button.Bounds.Height >= button.FontSize));
            MacHost.Save(window, "text-size-charts-150");

            window.Navigate(AppPage.Options);
            for (var round = 0; round < 20 && !AppServices.Get<OptionsViewModel>().HasRows; round++)
            {
                await Task.Delay(25);
                MacHost.Pump();
            }
            var chain = Assert.IsType<OptionsPage>(window.CurrentView).FindControl<DataGrid>("ChainList")!;
            Assert.True(chain.IsEffectivelyVisible);
            var largeWidths = chain.Columns.Select(column => column.Width.Value).ToArray();
            Assert.NotEmpty(largeWidths);
            MacHost.Save(window, "text-size-chain-150");
            vm.TextSizeIndex = 0;
            MacHost.Pump(10);
            Assert.Equal(largeWidths.Length, chain.Columns.Count);
            for (var index = 0; index < largeWidths.Length; index++)
                Assert.Equal(largeWidths[index], chain.Columns[index].Width.Value * 1.5, 6);
            MacHost.Save(window, "text-size-chain-standard");
        }
        finally
        {
            window.Close();
            if (vm is not null) vm.TextSizeIndex = AppSettings.TextSizeChoices.ToList().IndexOf(original);
            LocalizationService.Current.Apply(originalLanguage);
        }
    }
}
