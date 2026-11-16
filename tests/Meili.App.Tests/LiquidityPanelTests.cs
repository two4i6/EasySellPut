using System.Windows;
using System.Windows.Controls;
using Meili.App.Services;
using Meili.App.Views.Controls;
namespace Meili.App.Tests;
public sealed class LiquidityPanelTests
{
    [Fact]public void Native_liquidity_panel_has_six_cards_eleven_actionable_cells_and_chart_navigation()
    {
        WpfHost.Run(async()=>
        {
            var model=AppServices.Get<LiquidityViewModel>();var panel=new LiquidityPanel{DataContext=model,Width=1200};var window=new Window{Content=panel,Width=1300,Height=900};
            NavigationRequest? navigation=null;var nav=AppServices.Get<NavigationHub>();EventHandler<NavigationRequest> handler=(_,e)=>navigation=e;nav.Requested+=handler;
            try{window.Show();await model.ActivateAsync();await WpfHost.Settle();Assert.Equal(49.8,model.PressureValue);Assert.Equal(model.PressureValue,Assert.Single(UiAudit.Descendants<AppGauge>(panel)).Value);Assert.Equal(6,model.Metrics.Count);Assert.Equal(11,model.Sectors.Count);Assert.Equal(8,UiAudit.Descendants<AppCard>(panel).Count());var cells=UiAudit.Descendants<Button>((ItemsControl)panel.FindName("SectorHeatmap")).ToArray();Assert.Equal(11,cells.Length);cells[0].Command.Execute(cells[0].CommandParameter);Assert.Equal("XLB",navigation!.Symbol);}
            finally{model.Deactivate();window.Close();nav.Requested-=handler;}
        });
    }
    private sealed class BrokenSource : Meili.Core.Abstractions.ILiquiditySeriesSource
    {
        public Task<Meili.Core.Models.LiquiditySeries> GetSeriesAsync(string id,CancellationToken ct=default)
            =>Task.FromException<Meili.Core.Models.LiquiditySeries>(new System.IO.IOException("offline"));
    }
    [Fact]public void Missing_macro_displays_recovery_instead_of_empty_gauge_and_navigation_remains_actionable()
    {
        WpfHost.Run(async()=>
        {
            var nav=new NavigationHub();NavigationRequest? selected=null;nav.Requested+=(_,request)=>selected=request;
            var model=new LiquidityViewModel(new(new BrokenSource(),new FakeMarketDataService(),Meili.Testing.LiquidityFixture.Clock),AppServices.Get<LocalizationService>(),nav);
            var panel=new LiquidityPanel{DataContext=model};using var host=new OffscreenHost(panel,1920,1080);
            try
            {
                await model.ActivateAsync();await WpfHost.Settle();
                Assert.True(model.ShowMacroProblem);Assert.False(UiAudit.Descendants<AppGauge>(panel).Single().IsVisible);
                model.OpenSourcesCommand.Execute(null);Assert.Equal(AppPage.DataSources,selected!.Page);
            }
            finally{model.Deactivate();}
        });
    }

}
