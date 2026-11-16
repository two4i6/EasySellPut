using Avalonia.Controls;
using Meili.Mac.Platform;
namespace Meili.Mac.Views;
public sealed class QqqGexPage : UserControl
{
    private void PresentationChanged(object? sender,EventArgs e){session?.UpdatePresentation(MacChartPalette.Current(AppServices.Get<MacTheme>().IsDark));}
    private QqqGexSession? session;private QqqGexActivity? capture;
    public QqqGexPage()
    {
        AttachedToVisualTree+=(_,_)=>{if(session is not null)return;session=new QqqGexSession(System.IO.Path.Combine(AppServices.DataDirectory.Path,"cache","qqq-gex.db"),quotes:AppServices.Get<Meili.Core.Quotes.QuoteHub>(),activity:AppServices.Get<DesktopActivity>());Ui.Platform.ColorsChanged+=PresentationChanged;DesignMotion.Changed+=PresentationChanged;PresentationChanged(null,EventArgs.Empty);var view=new NewsWebView{NavigationPolicy=session.IsPageUrl};Content=view;view.Navigate(session.PageUri.AbsoluteUri);capture=new QqqGexActivity(AppServices.Get<Meili.Core.Abstractions.IMarketDataService>(),AppServices.DataDirectory.Path,AppServices.Get<DesktopActivity>());capture.Published+=session.NotifyDataUpdated;capture.Start();};
        DetachedFromVisualTree+=(_,_)=>{Ui.Platform.ColorsChanged-=PresentationChanged;DesignMotion.Changed-=PresentationChanged;capture?.Dispose();capture=null;Content=null;session?.Dispose();session=null;};
    }
}
