using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Input;
using Avalonia.Interactivity;
using Meili.Core.Quotes;
using Meili.Core.Settings;
using Meili.Mac.Platform;
using Meili.Mac.Views;
using Meili.Mac.Views.Controls;
using Meili.Shared.ViewModels;

namespace Meili.Mac.Tests;

public sealed class ChartWorkspaceTests
{
    [AvaloniaTheory]
    [InlineData(980, 620, "zh-CN", false)]
    [InlineData(980, 620, "en-US", true)]
    [InlineData(1320, 840, "zh-CN", true)]
    [InlineData(1320, 840, "en-US", false)]
    [InlineData(1920, 1080, "en-US", true)]
    [InlineData(1920, 1080, "zh-CN", false)]
    public async Task Chart_keeps_the_space_and_settings_remain_accessible(int width,int height,string language,bool dark)
    {
        MacHost.EnsureComposed();
        var loc=AppServices.Get<LocalizationService>();var original=loc.Language;
        var theme=AppServices.Get<MacTheme>();var vm=AppServices.Get<ChartsViewModel>();
        vm.ShowInspector=false;vm.DrawMode=null;loc.Apply(language);theme.Apply(dark?AppThemeMode.Dark:AppThemeMode.Light);
        var window=new MainWindow{Width=width,Height=height};
        try
        {
            window.Show();window.Navigate(AppPage.Charts);MacHost.Pump(15);
            var page=(ChartsPage)window.CurrentView!;
            var chart=page.FindControl<WebChartControl>("Chart")!;
            var inspector=page.FindControl<Border>("ChartInspector")!;
            var toggle=page.FindControl<ToggleButton>("InspectorToggle")!;
            Assert.False(inspector.IsVisible);
            var toolbar=page.FindControl<Grid>("ChartToolbar")!;
            var tabs=page.FindControl<ItemsControl>("RangeTabs")!;
            Assert.True(toolbar.Bounds.Height<=56,$"Toolbar unexpectedly gained a row: {toolbar.Bounds}");
            var rangeButtons=tabs.GetVisualDescendants().OfType<Button>().ToArray();
            Assert.Equal(15,rangeButtons.Length);
            Assert.All(rangeButtons,b=>Assert.InRange(b.TranslatePoint(new Point(),page)!.Value.Y-rangeButtons[0].TranslatePoint(new Point(),page)!.Value.Y,-1,1));
            var workspace = page.FindControl<MarketWorkspaceLayout>("Workspace")!;
            var input = workspace.FindControl<SymbolBox>("SymbolInput")!;
            Assert.True(input.TranslatePoint(new Point(), page)!.Value.Y < toolbar.TranslatePoint(new Point(), page)!.Value.Y);

            Assert.True(chart.Bounds.Height>page.Bounds.Height*.72,$"Chart height: {chart.Bounds}, page: {page.Bounds}");
            Assert.True(chart.Bounds.Width > page.Bounds.Width * .65);
            Assert.Equal(loc["Ch_Tools"],Avalonia.Automation.AutomationProperties.GetName(toggle));
            Assert.Equal("Settings",Assert.IsType<Meili.Mac.Views.Controls.LucideIcon>(toggle.Content).Kind);
            Assert.Equal(48,page.FindControl<Border>("DrawingToolbar")!.Bounds.Width);
            MacHost.Save(window,$"workspace-{width}-{language}-{dark}-default");
            if(Environment.GetEnvironmentVariable("MEILI_RENDER_DIR") is {Length:>0} renderDir)
            {
                using var toolbarFrame=new RenderTargetBitmap(new PixelSize((int)Math.Ceiling(toolbar.Bounds.Width),(int)Math.Ceiling(toolbar.Bounds.Height)));
                toolbarFrame.Render(toolbar);
                toolbarFrame.Save(Path.Combine(renderDir,$"toolbar-{width}-{language}-{dark}.png"),new PngBitmapEncoderOptions());
            }
            rangeButtons[^1].Focus(NavigationMethod.Tab);MacHost.Pump();
            var scroller=page.FindControl<ScrollViewer>("RangeScroller")!;
            var lastX=rangeButtons[^1].TranslatePoint(new Point(),scroller)!.Value.X;
            Assert.InRange(lastX,-1,scroller.Bounds.Width-rangeButtons[^1].Bounds.Width+2);

            var fullWidth=chart.Bounds.Width;
            toggle.IsChecked=true;MacHost.Pump();
            Assert.True(vm.ShowInspector);Assert.True(inspector.IsVisible);
            Assert.InRange(fullWidth-chart.Bounds.Width,279,281);
            Assert.True(chart.Bounds.Width>=400);
            Assert.True(page.FindControl<TextBox>("CompareBox")!.IsEffectivelyVisible);
            var draw=page.GetVisualDescendants().OfType<ToggleButton>().First(b=>Equals(b.CommandParameter,DrawingKind.HorizontalLine));
            Assert.Equal(Color.FromUInt32(Meili.Shared.Services.ThemePalette.For(dark).Control),((ISolidColorBrush)draw.Background!).Color);
            draw.Command!.Execute(draw.CommandParameter);await Task.Delay(160);MacHost.Pump();Assert.True(draw.IsChecked);
            Assert.Equal(Color.FromUInt32(Meili.Shared.Services.ThemePalette.For(dark).RowHighlight),((ISolidColorBrush)draw.Background!).Color);
            var pan=page.GetVisualDescendants().OfType<ToggleButton>().Single(b=>b.Command==vm.CancelDrawingCommand);
            Assert.False(pan.IsChecked);pan.Command!.Execute(null);MacHost.Pump();Assert.False(draw.IsChecked);Assert.True(pan.IsChecked);
            var toolButtons=page.FindControl<Border>("DrawingToolbar")!.GetVisualDescendants().OfType<Button>().ToArray();
            Assert.All(toolButtons,b=>{Assert.Equal(32,b.Bounds.Width);Assert.Equal(32,b.Bounds.Height);});
            MacHost.Save(window,$"workspace-{width}-{language}-{dark}-inspector");
            toggle.IsChecked=false;MacHost.Pump();Assert.False(vm.ShowInspector);
            Assert.Equal(fullWidth,chart.Bounds.Width);
        }
        finally{window.Close();vm.ShowInspector=false;vm.DrawMode=null;loc.Apply(original);theme.Apply(AppThemeMode.System);}
    }

    [AvaloniaFact]
    public async Task Independent_pages_share_watchlist_selection_quote_and_panel_preference()
    {
        MacHost.EnsureComposed();
        var window = new MainWindow { Width = 1320, Height = 840 };
        var model = AppServices.Get<MarketWorkspaceViewModel>();
        var context = AppServices.Get<SymbolContext>();
        var hub = AppServices.Get<QuoteHub>();
        var previous = context.Current;
        try
        {
            window.Show();
            window.Navigate(AppPage.Charts);
            MacHost.Pump(15);
            var charts = Assert.IsType<ChartsPage>(window.CurrentView);
            var chartFrame = charts.FindControl<MarketWorkspaceLayout>("Workspace")!;
            var watch = chartFrame.FindControl<MarketWatchlist>("WatchlistView")!.FindControl<ListBox>("WorkspaceWatchRows")!;
            var target = model.Rows.First(row => row.Symbol != context.Current);
            watch.SelectedItem = target;
            MacHost.Pump();
            Assert.Equal(target.Symbol, context.Current);
            Assert.Equal(target.Symbol, AppServices.Get<ChartsViewModel>().Series?.Symbol);
            Assert.Equal(target.Symbol, model.Current?.Symbol);
            Assert.Contains(target.Symbol, hub.SubscribedSymbols);

            window.Navigate(AppPage.Options);
            for (var i = 0; i < 20 && !AppServices.Get<OptionsViewModel>().HasRows; i++)
            {
                await Task.Delay(25);
                MacHost.Pump();
            }
            var options = Assert.IsType<OptionsPage>(window.CurrentView);
            Assert.Equal(AppPage.Options, window.CurrentPage);
            var optionFrame = options.FindControl<MarketWorkspaceLayout>("Workspace")!;
            Assert.Equal(target.Symbol, Assert.IsType<WorkspaceQuote>(optionFrame.FindControl<MarketWatchlist>("WatchlistView")!.FindControl<ListBox>("WorkspaceWatchRows")!.SelectedItem).Symbol);
            var quote = optionFrame.FindControl<Border>("WorkspaceQuote")!;
            Assert.True(quote.IsVisible);
            var quoteToggle = optionFrame.FindControl<ToggleButton>("QuoteToggle")!;
            quoteToggle.IsChecked = false;
            quoteToggle.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            Assert.False(quote.IsVisible);
            Assert.Contains(target.Symbol, AppServices.Get<OptionsViewModel>().Headline);
            Assert.True(options.FindControl<DataGrid>("ChainList")!.IsEffectivelyVisible);

            var box = optionFrame.FindControl<SymbolBox>("SymbolInput")!;
            box.Text = "invalid symbol!";
            box.CommitCommand!.Execute(null);
            Assert.Equal(target.Symbol, context.Current);
            Assert.Equal(LocalizationService.Current["Ch_InvalidSymbol"], model.SymbolError);

            box.Text = "TEST";
            box.CommitCommand!.Execute(null);
            MacHost.Pump();
            Assert.Equal("TEST", context.Current);
            Assert.Equal("TEST", model.Current?.Symbol);
            Assert.Empty(model.SymbolError);
            window.Navigate(AppPage.Charts);
            MacHost.Pump();
            Assert.Same(charts, window.CurrentView);
            Assert.Equal("TEST", AppServices.Get<ChartsViewModel>().Series?.Symbol);
            window.Navigate(AppPage.Settings);
            Assert.DoesNotContain("TEST", hub.SubscribedSymbols);
        }
        finally
        {
            window.Close();
            model.SetPanelPreference(compact: false, watchlist: true, quote: true);
            if (previous is not null) context.Set(previous);
        }
    }
}
