using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Meili.Core.Diagnostics;

namespace Meili.App.Services;

/// <summary>Remote browser content has no native host objects, web messaging or chart session.</summary>
public sealed class WebTabPane : UserControl, IDisposable
{
    private readonly WebView2 _web = new();
    private readonly TextBox _address = new() { MinWidth = 80, VerticalContentAlignment = VerticalAlignment.Center };
    private readonly TextBlock _status = new() { Margin = new Thickness(12, 4, 12, 4), FontSize = 12, Visibility = Visibility.Collapsed };
    private readonly Button _back = new(), _forward = new(), _reload = new(), _external = new(), _edit = new();
    private readonly LocalizationService _loc = LocalizationService.Current;
    private string _pending;
    private bool _ready, _initializing, _disposed;
    private string _statusKey = "";
    public event Action? EditRequested;
    public string Address => _pending;
    public string DocumentTitle => _ready ? _web.CoreWebView2.DocumentTitle : "";
    public WebTabPane(string url)
    {
        _pending = url; _address.Text = url;
        var root = new DockPanel(); var toolbar = new Grid { Margin = new Thickness(12, 8, 12, 8) };
        var controls = new Control[] { _back, _forward, _reload, _address, _external, _edit };
        for (var i = 0; i < controls.Length; i++) { toolbar.ColumnDefinitions.Add(new ColumnDefinition { Width = i == 3 ? new GridLength(1, GridUnitType.Star) : GridLength.Auto }); Grid.SetColumn(controls[i], i); toolbar.Children.Add(controls[i]); controls[i].Margin = new Thickness(0, 0, i == 5 ? 0 : 6, 0); }
        foreach (var b in new[] { _back, _forward, _reload, _external, _edit }) { b.Width = 32; b.Height = 32; b.Padding = new Thickness(0); b.HorizontalContentAlignment = HorizontalAlignment.Center; b.VerticalContentAlignment = VerticalAlignment.Center; }
        _back.Content = "←"; _forward.Content = "→"; _reload.Content = "↻"; _external.Content = "↗"; _edit.Content = "⋯";
        DockPanel.SetDock(toolbar, Dock.Top); root.Children.Add(toolbar); DockPanel.SetDock(_status, Dock.Top); root.Children.Add(_status); root.Children.Add(_web); Content = root;
        _status.SetResourceReference(TextBlock.ForegroundProperty, "TextFillColorSecondaryBrush");
        _back.Click += (_, _) => { if (_ready && _web.CanGoBack) _web.GoBack(); }; _forward.Click += (_, _) => { if (_ready && _web.CanGoForward) _web.GoForward(); }; _reload.Click += (_, _) => { if (_ready) _web.Reload(); };
        _external.Click += (_, _) => { if (NewsReaderPolicy.IsAllowed(Address)) Ui.Platform.OpenUrl(Address); }; _edit.Click += (_, _) => EditRequested?.Invoke();
        _address.KeyDown += (sender, e) => { if (e.Key != Key.Enter) return; e.Handled = true; if (WebWorkspace.TryNormalize("Web", _address.Text, out _, out var next)) { _pending = next; if (_ready) _web.CoreWebView2.Navigate(next); } else { _status.Text = _loc["Web_Invalid"]; _status.Visibility = Visibility.Visible; } };
        _loc.LanguageChanged += Relabel; Relabel(this, EventArgs.Empty);
        Loaded += async (_, _) => { if (!_initializing) { _initializing = true; await InitializeAsync(); } };
    }
    public void ReloadPage() { if (_ready) _web.Reload(); }
    public void FocusAddress() { _address.Focus(); _address.SelectAll(); }
    private void SetStatus(string key) { _statusKey = key; _status.Text = key.Length == 0 ? "" : _loc[key]; _status.Visibility = key.Length == 0 ? Visibility.Collapsed : Visibility.Visible; }
    private void Relabel(object? sender, EventArgs e)
    {
        var buttons = new[] { _back, _forward, _reload, _external, _edit }; var keys = new[] { "Reader_Back", "Reader_Forward", "Reader_Reload", "Reader_External", "Web_Edit" };
        for (var i = 0; i < buttons.Length; i++) { buttons[i].ToolTip = _loc[keys[i]]; System.Windows.Automation.AutomationProperties.SetName(buttons[i], _loc[keys[i]]); }
        System.Windows.Automation.AutomationProperties.SetName(_address, _loc["Web_Address"]); SetStatus(_statusKey);
    }
    private async Task InitializeAsync()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(AppServices.DataDirectory.Path, "browser", "webview2"));
            if (_disposed) return;
            var options = env.CreateCoreWebView2ControllerOptions(); options.IsInPrivateModeEnabled = true;
            await _web.EnsureCoreWebView2Async(env, options); if (_disposed) return;
            var core = _web.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false; core.Settings.IsWebMessageEnabled = false; core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false; core.Settings.AreDefaultScriptDialogsEnabled = false;
            core.LaunchingExternalUriScheme += (_, e) => { e.Cancel = true; SetStatus("Reader_Blocked"); };
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.DownloadStarting += (_, e) => { e.Cancel = true; SetStatus("Reader_Blocked"); };
            core.NewWindowRequested += (_, e) => { e.Handled = true; if (NewsReaderPolicy.IsAllowed(e.Uri)) core.Navigate(e.Uri); else SetStatus("Reader_Blocked"); };
            core.NavigationStarting += (_, e) => { e.Cancel = !NewsReaderPolicy.IsAllowed(e.Uri); SetStatus(e.Cancel ? "Reader_Blocked" : "Reader_Loading"); if (!e.Cancel) { _pending = e.Uri; if (!_address.IsKeyboardFocusWithin) _address.Text = e.Uri; } };
            core.HistoryChanged += (_, _) => { _back.IsEnabled = core.CanGoBack; _forward.IsEnabled = core.CanGoForward; };
            core.NavigationCompleted += (_, e) => SetStatus(e.IsSuccess && e.HttpStatusCode < 400 ? "" : "Reader_Failed");
            core.ProcessFailed += (_, _) => SetStatus("Reader_Failed");
            _ready = true; _back.IsEnabled = _forward.IsEnabled = false; core.Navigate(_pending);
        }
        catch (Exception ex) { AppLog.Warn("web-workspace", "Browser initialization failed", ex); if (!_disposed) SetStatus(ex is WebView2RuntimeNotFoundException ? "Reader_Runtime" : "Reader_Failed"); }
    }
    public void Dispose() { _disposed = true; _loc.LanguageChanged -= Relabel; _web.Dispose(); }
}
