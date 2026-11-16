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
            Assert.Equal(8,panel.GetVisualDescendants().OfType<AppCard>().Count());Assert.Contains("1.0",model.Metrics[0].Value);
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
    private sealed class RecoverySource : Meili.Core.Abstractions.ILiquiditySeriesSource
    {
        public bool Fail=true;
        public Task<Meili.Core.Models.LiquiditySeries> GetSeriesAsync(string id,CancellationToken ct=default)
            =>Fail?Task.FromException<Meili.Core.Models.LiquiditySeries>(new IOException("offline")):new Meili.Testing.LiquidityFixture().GetSeriesAsync(id,ct);
    }
    [AvaloniaTheory][InlineData("zh-CN",true)][InlineData("en-US",false)]
    public async Task Failed_macro_uses_compact_recovery_and_retry_restores_gauge(string language,bool dark)
    {
        MacHost.EnsureComposed();var loc=LocalizationService.Current;var original=loc.Language;loc.Apply(language);var theme=AppServices.Get<MacTheme>();theme.Apply(dark?AppThemeMode.Dark:AppThemeMode.Light);
        var source=new RecoverySource();var nav=new NavigationHub();var model=new LiquidityViewModel(new(source,MacHost.Data,Meili.Testing.LiquidityFixture.Clock),loc,nav);
        var panel=new LiquidityPanel{DataContext=model,MaxWidth=1200,Margin=new Thickness(24)};
        var window=new Window{Width=1920,Height=1080,Content=new ScrollViewer{Content=panel}};
        try
        {
            window.Show();await model.ActivateAsync();MacHost.Pump();
            Assert.True(model.ShowMacroProblem);Assert.False(panel.GetVisualDescendants().OfType<AppGauge>().Single().IsEffectivelyVisible);
            Assert.Equal(11,panel.FindControl<ItemsControl>("SectorHeatmap")!.GetVisualDescendants().OfType<Button>().Count());
            MacHost.Save(window,$"liquidity-recovery-{language}-{dark}");
            NavigationRequest? selected=null;nav.Requested+=(_,request)=>selected=request;
            model.OpenSourcesCommand.Execute(null);Assert.Equal(AppPage.DataSources,selected!.Page);
            source.Fail=false;await model.RefreshCommand.ExecuteAsync(null);MacHost.Pump();
            Assert.False(model.ShowMacroProblem);Assert.True(panel.GetVisualDescendants().OfType<AppGauge>().Single().IsEffectivelyVisible);Assert.Equal(49.8,model.PressureValue);
            MacHost.Save(window,$"liquidity-recovered-{language}-{dark}");
        }
        finally{model.Deactivate();window.Close();loc.Apply(original);theme.Apply(AppThemeMode.System);}
    }

}
