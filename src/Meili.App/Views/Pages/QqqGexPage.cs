using System.IO;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
namespace Meili.App.Views.Pages;
public sealed class QqqGexPage : Page
{
    private QqqGexActivity? capture;
    private WebView2? web; private QqqGexSession? session;
    public QqqGexPage() { Loaded+=async(_,_)=>await Start();Unloaded+=(_,_)=>Stop(); }
    private async Task Start()
    {
        if(session is not null)return;
        var active=new QqqGexSession(System.IO.Path.Combine(AppServices.DataDirectory.Path,"cache","qqq-gex.db"));session=active;var view=new WebView2();web=view;Content=view;
        try {
            var env=await CoreWebView2Environment.CreateAsync(null,Path.Combine(AppServices.DataDirectory.Path,"browser","qqq-gex"));
            if(session!=active)return;await view.EnsureCoreWebView2Async(env);if(session!=active)return;
            var core=view.CoreWebView2;core.Settings.AreHostObjectsAllowed=false;core.Settings.IsWebMessageEnabled=false;core.Settings.AreDevToolsEnabled=false;
            core.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;core.DownloadStarting+=(_,e)=>e.Cancel=true;core.NewWindowRequested+=(_,e)=>e.Handled=true;
            core.NavigationStarting+=(_,e)=>e.Cancel=!active.IsPageUrl(e.Uri);core.Navigate(active.PageUri.AbsoluteUri);
            capture=new QqqGexActivity(AppServices.Get<Meili.Core.Abstractions.IMarketDataService>(),AppServices.DataDirectory.Path,AppServices.Get<DesktopActivity>());
            capture.Published+=()=>{if(session==active)active.NotifyDataUpdated();};capture.Start();
        }catch(Exception) {if(session==active)Content=new TextBlock{Text=LocalizationService.Current["Reader_Failed"],Margin=new Thickness(16)};}
    }
    private void Stop(){capture?.Dispose();capture=null;session?.Dispose();session=null;web?.Dispose();web=null;Content=null;}
}
