using Avalonia.Controls;
using Meili.Mac.Platform;
namespace Meili.Mac.Views;
public sealed class QqqGexPage : UserControl
{
    private void PresentationChanged(object? sender,EventArgs e){session?.UpdatePresentation(MacChartPalette.Current(AppServices.Get<MacTheme>().IsDark));}
    private QqqGexSession? session;private QqqGexActivity? capture;
    public QqqGexPage()
    {
        AttachedToVisualTree+=(_,_)=>{if(session is not null)return;try{session=new QqqGexSession(System.IO.Path.Combine(AppServices.DataDirectory.Path,"cache","qqq-gex.db"),quotes:AppServices.Get<Meili.Core.Quotes.QuoteHub>(),activity:AppServices.Get<DesktopActivity>());Ui.Platform.ColorsChanged+=PresentationChanged;DesignMotion.Changed+=PresentationChanged;PresentationChanged(null,EventArgs.Empty);Content=new Meili.Mac.Views.Controls.PrivateAppView(session);capture=new QqqGexActivity(AppServices.Get<Meili.Core.Abstractions.IMarketDataService>(),AppServices.DataDirectory.Path,AppServices.Get<DesktopActivity>());capture.Published+=session.NotifyDataUpdated;var running=capture;capture.StateChanged+=()=>session?.UpdateCaptureState(running.State);capture.Start();}catch(Exception ex){Meili.Core.Diagnostics.AppLog.Warn("app-view","GEX viewer could not start",ex);Ui.Platform.ColorsChanged-=PresentationChanged;DesignMotion.Changed-=PresentationChanged;capture?.Dispose();capture=null;session?.Dispose();session=null;Content=new TextBlock{Text=LocalizationService.Current["Apps_Error"],Margin=new Avalonia.Thickness(24),TextWrapping=Avalonia.Media.TextWrapping.Wrap};}};
        DetachedFromVisualTree+=(_,_)=>{Ui.Platform.ColorsChanged-=PresentationChanged;DesignMotion.Changed-=PresentationChanged;capture?.Dispose();capture=null;Content=null;session?.Dispose();session=null;};
    }
}
