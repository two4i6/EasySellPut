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
            try{window.Show();await model.ActivateAsync();await WpfHost.Settle();Assert.Equal(49.8,model.PressureValue);Assert.Equal(model.PressureValue,Assert.Single(UiAudit.Descendants<AppGauge>(panel)).Value);Assert.Equal(6,model.Metrics.Count);Assert.Equal(11,model.Sectors.Count);Assert.Equal(7,UiAudit.Descendants<AppCard>(panel).Count());var cells=UiAudit.Descendants<Button>((ItemsControl)panel.FindName("SectorHeatmap")).ToArray();Assert.Equal(11,cells.Length);cells[0].Command.Execute(cells[0].CommandParameter);Assert.Equal("XLB",navigation!.Symbol);}
            finally{model.Deactivate();window.Close();nav.Requested-=handler;}
        });
    }
}
