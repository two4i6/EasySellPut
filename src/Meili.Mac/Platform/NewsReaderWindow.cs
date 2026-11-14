using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;

namespace Meili.Mac.Platform;

public sealed class NewsReaderWindow : Window
{
    private readonly NewsWebView _web = new();
    private readonly TextBlock _status = new() { Margin = new Thickness(8), TextWrapping = Avalonia.Media.TextWrapping.Wrap };
    private readonly TextBox _address = new() { IsReadOnly = true };
    private readonly Button _back = new(), _forward = new(), _reload = new(), _external = new();
    private readonly LocalizationService _loc = LocalizationService.Current;
    private string? _url;
    public NewsReaderWindow()
    {
        Width = 1050; Height = 760; MinWidth = 640; MinHeight = 400;
        var root = new DockPanel();
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(6), Spacing = 6 };
        foreach (var button in new[] { _back, _forward, _reload, _external }) toolbar.Children.Add(button);
        DockPanel.SetDock(toolbar, Dock.Top); root.Children.Add(toolbar);
        DockPanel.SetDock(_address, Dock.Top); root.Children.Add(_address);
        DockPanel.SetDock(_status, Dock.Top); root.Children.Add(_status);
        root.Children.Add(_web); Content = root;
        _back.Click += (_, _) => _web.Back(); _forward.Click += (_, _) => _web.Forward();
        _reload.Click += (_, _) => _web.Reload();
        _external.Click += (_, _) => { if (NewsReaderPolicy.IsAllowed(_url)) Ui.Platform.OpenUrl(_url!); };
        _web.Changed += Update;
        _loc.LanguageChanged += Relabel;
        Relabel(this, EventArgs.Empty);
        Closed += (_, _) => { _loc.LanguageChanged -= Relabel; _web.Changed -= Update; };
    }
    public void OpenArticle(string url, string title)
    {
        if (!NewsReaderPolicy.IsAllowed(url)) { _status.Text = _loc["Reader_Blocked"]; return; }
        _url = url; _address.Text = url; Title = title; _web.Navigate(url);
    }
    private void Update()
    {
        if (NewsReaderPolicy.IsAllowed(_web.Address)) { _url = _web.Address; _address.Text = _url; }
        if (_web.DocumentTitle.Length > 0) Title = _web.DocumentTitle;
        _status.Text = _web.StatusKey.Length == 0 ? "" : _loc[_web.StatusKey];
        _back.IsEnabled = _web.CanGoBack; _forward.IsEnabled = _web.CanGoForward;
    }
    private void Relabel(object? sender, EventArgs e)
    {
        Title = _loc["Reader_Title"];
        _back.Content = _loc["Reader_Back"]; _forward.Content = _loc["Reader_Forward"];
        _reload.Content = _loc["Reader_Reload"]; _external.Content = _loc["Reader_External"];
        Update();
    }
}
