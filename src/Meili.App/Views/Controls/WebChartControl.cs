using System.IO;
using System.Windows;
using System.Windows.Controls;
using Meili.Core.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Meili.App.Views.Controls;

/// <summary>Trusted, bundled chart surface. Untrusted news content uses a separate profile and window.</summary>
public sealed class WebChartControl : UserControl
{
    private WebView2? _web;
    private readonly DockPanel _root = new();
    private readonly TextBlock _status = new() { Margin = new Thickness(8), TextWrapping = TextWrapping.Wrap };
    private readonly Button _install = new() { Content = LocalizationService.Current["Reader_Install"], Visibility = Visibility.Collapsed };
    public WebChartSession? Session { get; private set; }
    public string? LastDiagnostic { get; private set; }
    public WebChartControl()
    {
        DockPanel.SetDock(_status, Dock.Top); _root.Children.Add(_status);
        DockPanel.SetDock(_install, Dock.Top); _root.Children.Add(_install);
        _install.Click += (_, _) => Ui.Platform.OpenUrl("https://developer.microsoft.com/microsoft-edge/webview2/#download-section");
        Content = _root;
    }
    public void Start(ChartsViewModel vm, ChartPalette palette)
    {
        Stop();
        Session = new WebChartSession(vm); Session.Update(palette);
        Session.DiagnosticReceived += OnDiagnostic;
        _status.Visibility = Visibility.Visible;
        _status.Text = LocalizationService.Current["Ch_WebLoading"];
        var web = new WebView2(); _web = web;
        web.Loaded += async (_, _) => await InitializeAsync(web, Session);
        _root.Children.Add(web);
    }
    private void OnDiagnostic(System.Text.Json.JsonElement e)
    {
        LastDiagnostic = e.GetRawText();
        _status.Visibility = e.GetProperty("status").GetString() == "rendered" ? Visibility.Collapsed : Visibility.Visible;
        _status.Text = e.GetProperty("status").GetString() == "rendered" ? "" : LocalizationService.Current["Ch_WebFailed"];
        if (e.TryGetProperty("message", out var message)) AppLog.Warn("web-chart", message.GetString() ?? "Chart script failed");
    }
    private async Task InitializeAsync(WebView2 web, WebChartSession? session)
    {
        if (session is null) return;
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(AppServices.DataDirectory.Path, "browser", "charts"));
            if (_web != web || Session != session) return;
            await web.EnsureCoreWebView2Async(env);
            if (_web != web || Session != session) return;
            var core = web.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false; core.Settings.IsWebMessageEnabled = false;
            core.Settings.AreDefaultScriptDialogsEnabled = false; core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.DownloadStarting += (_, e) => e.Cancel = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.NavigationStarting += (_, e) => e.Cancel = !session.IsPageUrl(e.Uri);
            core.ProcessFailed += (_, _) => _status.Text = LocalizationService.Current["Ch_WebFailed"];
            core.NavigationCompleted += (_, e) => { if (!e.IsSuccess) _status.Text = LocalizationService.Current["Ch_WebFailed"]; };
            core.Navigate(session.PageUri.AbsoluteUri);
        }
        catch (Exception ex)
        {
            AppLog.Warn("web-chart", "WebView2 chart initialization failed", ex);
            if (_web != web) return;
            _status.Text = LocalizationService.Current[ex is WebView2RuntimeNotFoundException ? "Reader_Runtime" : "Ch_WebFailed"];
            _install.Visibility = ex is WebView2RuntimeNotFoundException ? Visibility.Visible : Visibility.Collapsed;
        }
    }
    public void Update(ChartPalette palette) => Session?.Update(palette);
    public void Stop()
    {
        if (Session is { } session) { session.DiagnosticReceived -= OnDiagnostic; session.Dispose(); Session = null; }
        if (_web is { } web) { _web = null; _root.Children.Remove(web); web.Dispose(); }
        LastDiagnostic = null; _install.Visibility = Visibility.Collapsed;
    }
}
