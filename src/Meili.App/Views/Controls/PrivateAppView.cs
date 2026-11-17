using System.Windows.Controls;
using Meili.Automation.Modules;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
namespace Meili.App.Views.Controls;

/// <summary>Reusable WebView2 adapter for private app origins; no host objects, messages, permissions or downloads.</summary>
public sealed class PrivateAppView : Grid,IDisposable
{
    private WebView2? browser;
    public async Task NavigateAsync(IPrivateAppSession session,string browserFolder,CancellationToken ct=default)
    {
        Dispose();var view=new WebView2();browser=view;Children.Add(view);
        var environment=await CoreWebView2Environment.CreateAsync(null,browserFolder);
        ct.ThrowIfCancellationRequested();if(browser!=view)return;
        await view.EnsureCoreWebView2Async(environment);ct.ThrowIfCancellationRequested();if(browser!=view)return;
        var core=view.CoreWebView2;core.Settings.AreHostObjectsAllowed=false;core.Settings.IsWebMessageEnabled=false;core.Settings.AreDevToolsEnabled=false;
        core.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;core.DownloadStarting+=(_,e)=>e.Cancel=true;core.NewWindowRequested+=(_,e)=>e.Handled=true;
        core.NavigationStarting+=(_,e)=>e.Cancel=!session.IsPageUrl(e.Uri);core.Navigate(session.PageUri.AbsoluteUri);
    }
    public void Dispose(){var old=browser;browser=null;Children.Clear();old?.Dispose();}
}
