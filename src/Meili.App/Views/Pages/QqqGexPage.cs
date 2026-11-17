using Meili.App.Services;
using Meili.Core.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
namespace Meili.App.Views.Pages;
public sealed class QqqGexPage : Page
{
    private QqqGexActivity? capture;
    private void PresentationChanged(object? sender,EventArgs e){if(session is {} active)active.UpdatePresentation(WpfChartPalette.Current(AppServices.Get<ThemeService>().IsDark));}
    private Meili.App.Views.Controls.PrivateAppView? web; private QqqGexSession? session;
    public QqqGexPage() { Loaded+=async(_,_)=>await Start();Unloaded+=(_,_)=>Stop(); }
    private async Task Start()
    {
        if(session is not null)return;
        QqqGexSession? started=null;
        try {
        var active=new QqqGexSession(System.IO.Path.Combine(AppServices.DataDirectory.Path,"cache","qqq-gex.db"),quotes:AppServices.Get<Meili.Core.Quotes.QuoteHub>(),activity:AppServices.Get<DesktopActivity>(),appOperations:new Meili.Automation.Modules.PrivateAppOperations(AppServices.DataDirectory.Path,Meili.Automation.Modules.ModuleAccess.QqqGex,AppServices.Get<Meili.Automation.IOperationDispatcher>(),true));session=active;started=active;ThemeService.ColorsChanged+=PresentationChanged;DesignMotion.Changed+=PresentationChanged;LocalizationService.Current.LanguageChanged+=PresentationChanged;PresentationChanged(null,EventArgs.Empty);var view=new Meili.App.Views.Controls.PrivateAppView();web=view;Content=view;
            await view.NavigateAsync(active,Path.Combine(AppServices.DataDirectory.Path,"browser","qqq-gex"));
            if(session!=active)return;
            capture=new QqqGexActivity(AppServices.Get<Meili.Core.Abstractions.IMarketDataService>(),AppServices.DataDirectory.Path,AppServices.Get<DesktopActivity>());
            capture.Published+=()=>{if(session==active)active.NotifyDataUpdated();};var running=capture;capture.StateChanged+=()=>{if(session==active)active.UpdateCaptureState(running.State);};capture.Start();
        }catch(Exception ex) {AppLog.Warn("qqq-gex","Native viewer startup failed: "+ex.GetType().Name);if(started is null||session==started){Stop();Content=new TextBlock{Text=LocalizationService.Current["Reader_Failed"],Margin=new Thickness(16)};}}
    }
    private void Stop(){ThemeService.ColorsChanged-=PresentationChanged;DesignMotion.Changed-=PresentationChanged;LocalizationService.Current.LanguageChanged-=PresentationChanged;capture?.Dispose();capture=null;session?.Dispose();session=null;web?.Dispose();web=null;Content=null;}
}
