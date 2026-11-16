using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Meili.Mac.Platform;
using Meili.Mac.Views.Controls;
using Meili.Core.Settings;
namespace Meili.Mac.Tests;
public sealed class LiquidityPanelTests
{
    [AvaloniaTheory][InlineData("zh-CN",false)][InlineData("en-US",true)]
    public async Task Six_macro_cards_eleven_heat_cells_theme_and_chart_navigation_use_real_shared_controls(string language,bool dark)
    {
        MacHost.EnsureComposed();var loc=LocalizationService.Current;var original=loc.Language;loc.Apply(language);var theme=AppServices.Get<MacTheme>();theme.Apply(dark?AppThemeMode.Dark:AppThemeMode.Light);
        var model=AppServices.Get<LiquidityViewModel>();var panel=new LiquidityPanel{DataContext=model,MaxWidth=1200,Margin=new Thickness(24)};
        var scroll=new ScrollViewer{Content=panel};var window=new Window{Width=1920,Height=1080,Content=scroll};
        NavigationRequest? navigation=null;var nav=AppServices.Get<NavigationHub>();EventHandler<NavigationRequest> onNav=(_,e)=>navigation=e;nav.Requested+=onNav;
        try
        {
            window.Show();await model.ActivateAsync();MacHost.Pump();Assert.Equal(6,model.Metrics.Count);Assert.Equal(11,model.Sectors.Count);Assert.All(model.Sectors,s=>Assert.DoesNotContain("—",s.Value));
            Assert.Equal(49.8,model.PressureValue);Assert.Equal(model.PressureValue,Assert.Single(panel.GetVisualDescendants().OfType<AppGauge>()).Value);
            Assert.Equal(7,panel.GetVisualDescendants().OfType<AppCard>().Count());Assert.Contains("1.0",model.Metrics[0].Value);
            var cells=panel.FindControl<ItemsControl>("SectorHeatmap")!.GetVisualDescendants().OfType<Button>().ToArray();Assert.Equal(11,cells.Length);
            Assert.All(cells,c=>{Assert.True(c.Bounds.Width>120);Assert.NotNull(ToolTip.GetTip(c));Assert.True(c.Command!.CanExecute(c.CommandParameter));});
            var point=cells[0].TranslatePoint(new Point(cells[0].Bounds.Width/2,cells[0].Bounds.Height/2),window)!.Value;
            window.MouseDown(point,MouseButton.Left);window.MouseUp(point,MouseButton.Left);MacHost.Pump();Assert.Equal(AppPage.Charts,navigation!.Page);Assert.Equal("XLB",navigation.Symbol);
            window.MouseMove(new Point(10,10));MacHost.Pump();
            MacHost.Save(window,$"liquidity-1080p-{language}-{dark}");
            scroll.Offset=new Vector(0,panel.FindControl<ItemsControl>("SectorHeatmap")!.TranslatePoint(new Point(),panel)!.Value.Y);MacHost.Pump();MacHost.Save(window,$"liquidity-heatmap-1080p-{language}-{dark}");scroll.Offset=default;
            window.Width=980;MacHost.Pump();Assert.All(cells,c=>Assert.True(c.Bounds.Width>120));MacHost.Save(window,$"liquidity-compact-{language}-{dark}");
            var shell=new MainWindow{Width=1920,Height=1080};
            try
            {
                shell.Show();shell.Navigate(AppPage.Dashboard);MacHost.Pump();
                var integrated=shell.CurrentView!.GetVisualDescendants().OfType<LiquidityPanel>().Single();
                var pageScroll=shell.CurrentView!.GetVisualDescendants().OfType<ScrollViewer>().First();
                pageScroll.Offset=new Vector(0,integrated.TranslatePoint(new Point(),(Control)pageScroll.Content!)!.Value.Y);MacHost.Pump();MacHost.Save(shell,$"liquidity-workspace-1080p-{language}-{dark}");
            }
            finally{shell.AllowClose();shell.Close();}
        }
        finally{model.Deactivate();window.Close();nav.Requested-=onNav;loc.Apply(original);theme.Apply(AppThemeMode.System);}
    }
}
