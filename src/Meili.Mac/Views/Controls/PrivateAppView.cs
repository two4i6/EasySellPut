using Avalonia.Controls;
using Meili.Automation.Modules;
using Meili.Mac.Platform;
namespace Meili.Mac.Views.Controls;

/// <summary>Reusable WKWebView adapter for private app origins; no native JavaScript privileges.</summary>
public sealed class PrivateAppView : UserControl, IDisposable
{
    public PrivateAppView(IPrivateAppSession session)
    {
        var browser=new NewsWebView{NavigationPolicy=session.IsPageUrl};Content=browser;browser.Navigate(session.PageUri.AbsoluteUri);
    }
    public void Dispose()=>Content=null;
}
