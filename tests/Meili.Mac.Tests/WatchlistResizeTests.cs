using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.VisualTree;
using Meili.Core.Settings;
using Meili.Core.Models;
using Meili.Core.Time;
using Meili.Mac.Views;
using Meili.Mac.Views.Controls;

namespace Meili.Mac.Tests;

public sealed class WatchlistResizeTests
{
    [AvaloniaFact]
    public async Task DragRevealsHistoryAndExtraColumnsAndRestoresWidthOnOptions()
    {
        MacHost.EnsureComposed();
        var store = AppServices.Get<SettingsStore>();
        var original = store.Current.WorkspaceWatchlistWidth;
        var originalIndicators = store.Current.WatchlistSparkline;
        var model = AppServices.Get<MarketWorkspaceViewModel>();
        var window = new MainWindow { Width = 1670, Height = 840 };
        var oldBars = MacHost.Data.BarOverride;
        var now = DateTimeOffset.UtcNow;
        var today = MarketClock.ToEastern(now).Date;
        var intraday = Enumerable.Range(1, 4).OrderDescending().SelectMany(daysAgo =>
            Enumerable.Range(0, 18).Select(index =>
            {
                var time = MarketClock.FromEastern(today.AddDays(-daysAgo).AddHours(16).AddMinutes(5 * index));
                var price = 100 + Math.Sin(index * .45) * 3;
                return new Bar(time, price, price + 1, price - 1, price, daysAgo == 1 ? 200 : 100);
            })).ToArray();
        MacHost.Data.BarOverride = request => request.Interval == BarInterval.Minute5 ? new BarSeries
        {
            Symbol = request.Symbol,
            Interval = request.Interval,
            Source = "yahoo",
            Bars = intraday
        } : request.Interval != BarInterval.Day1 ? null : new BarSeries
        {
            Symbol = request.Symbol,
            Interval = BarInterval.Day1,
            Source = "yahoo",
            Adjustment = PriceAdjustment.Split,
            Bars = [Bar.CloseOnly(new DateTimeOffset(now.Year - 1, 12, 30, 21, 0, 0, TimeSpan.Zero), 100, 1),
                    Bar.CloseOnly(now, 110, 1)]
        };
        try
        {
            store.Update(value => value.WatchlistSparkline = new());
            model.SaveWatchlistWidth(176);
            window.Show();
            window.Navigate(AppPage.Charts);
            MacHost.Pump(15);
            var frame = Assert.IsType<ChartsPage>(window.CurrentView).FindControl<MarketWorkspaceLayout>("Workspace")!;
            var sidebar = frame.FindControl<Border>("WorkspaceWatchlist")!;
            var splitter = frame.FindControl<GridSplitter>("WatchlistSplitter")!;
            Assert.InRange(sidebar.Bounds.Width, 175, 177);
            Assert.False(model.ShowSparkline);
            MacHost.Save(window, "watchlist-collapsed-columns");

            var start = splitter.TranslatePoint(new Point(splitter.Bounds.Width / 2, 60), window)!.Value;
            var end = start + new Vector(540, 0);
            window.MouseDown(start, MouseButton.Left);
            window.MouseMove(end, RawInputModifiers.LeftMouseButton);
            window.MouseUp(end, MouseButton.Left);
            await model.RefreshAsync(force: true);
            for (var round = 0; round < 20 && !model.Rows.Any(row => row.HasSparkline && row.IsYearUp); round++)
            {
                await Task.Delay(25);
                MacHost.Pump();
            }

            Assert.InRange(sidebar.Bounds.Width, 708, 725);
            Assert.True(model.ShowSparkline && model.ShowAbsolute && model.ShowYear && model.ShowSessionMetrics);
            Assert.Contains(model.Rows, row => row.Sparkline.RelativeVolume == 2 && row.HasRangePosition);
            Assert.Contains(frame.GetVisualDescendants().OfType<ProgressBar>(), bar =>
                bar.IsEffectivelyVisible && bar.Value is > 0 and < 100 && bar.Bounds.Width <= 40);
            Assert.Contains(frame.GetVisualDescendants().OfType<TextBlock>(), value =>
                value.IsEffectivelyVisible && value.Text == "2.00×");
            Assert.Contains(model.Rows, row => row.Year == "+10.00%");
            Assert.Contains(frame.GetVisualDescendants().OfType<QuoteSparkline>(), plot => plot.IsEffectivelyVisible && plot.Data.Points.Count > 1);
            Assert.Equal(store.Current.WorkspaceWatchlistWidth, new SettingsStore(MacHost.DataDir).Load().WorkspaceWatchlistWidth);
            var width = sidebar.Bounds.Width;
            MacHost.Save(window, "watchlist-expanded-columns");

            var watchlist = frame.FindControl<MarketWatchlist>("WatchlistView")!;
            var indicatorMenu = watchlist.FindControl<AppPopover>("MiniIndicatorSettings")!;
            indicatorMenu.IsExpanded = true;
            MacHost.Pump(10);
            Assert.True(indicatorMenu.Flyout!.IsOpen);
            var form = Assert.IsType<StackPanel>(indicatorMenu.PopupContent);
            var maRow = form.Children.OfType<DockPanel>().First();
            var maToggle = maRow.Children.OfType<CheckBox>().Single();
            var maPeriod = maRow.Children.OfType<AppSelect>().Single();
            Assert.False(maPeriod.IsEnabled);
            maToggle.SetCurrentValue(CheckBox.IsCheckedProperty, true);
            MacHost.Pump();
            Assert.True(maPeriod.IsEnabled);
            maPeriod.SetCurrentValue(AppSelect.SelectedItemProperty, 4);
            form.Children.OfType<CheckBox>().Single().SetCurrentValue(CheckBox.IsCheckedProperty, true);
            var apply = form.Children.OfType<Button>().Single(button => button is not CheckBox);
            Assert.NotNull(apply.Command);
            apply.Command.Execute(null);
            MacHost.Pump(10);
            Assert.Equal("MA 4", model.MiniMaLabel);
            Assert.Equal("EMA 9", model.MiniEmaLabel);
            Assert.Equal("VWAP", model.MiniVwapLabel);
            Assert.Equal(new SparklineSettings(ShowMa: true, MaPeriod: 4, ShowVwap: true),
                new SettingsStore(MacHost.DataDir).Load().WatchlistSparkline);
            MacHost.Save(window, "watchlist-mini-indicators");
            indicatorMenu.IsExpanded = false;
            MacHost.Pump();
            Assert.Contains(frame.GetVisualDescendants().OfType<QuoteSparkline>(), chart =>
                chart.IsEffectivelyVisible && chart.Data.Vwap.Count > 1);
            Assert.Contains(frame.GetVisualDescendants().OfType<TextBlock>(), label =>
                label.IsEffectivelyVisible && label.Text?.StartsWith("VWAP ", StringComparison.Ordinal) == true);
            MacHost.Save(window, "watchlist-session-metrics");

            window.Navigate(AppPage.Options);
            MacHost.Pump(15);
            var options = Assert.IsType<OptionsPage>(window.CurrentView).FindControl<MarketWorkspaceLayout>("Workspace")!;
            Assert.Equal(width, options.FindControl<Border>("WorkspaceWatchlist")!.Bounds.Width);
            Assert.Contains(options.GetVisualDescendants().OfType<TextBlock>(), label => label.Text == "VWAP");
        }
        finally
        {
            window.Close();
            MacHost.Data.BarOverride = oldBars;
            model.SaveWatchlistWidth(original);
            store.Update(value => value.WatchlistSparkline = originalIndicators);
        }
    }
}
