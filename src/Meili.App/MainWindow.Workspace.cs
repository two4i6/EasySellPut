using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using Meili.App.Services;
using Meili.Core.Settings;

namespace Meili.App;

public partial class MainWindow
{
    private WebWorkspace? _workspace;
    private string? _activeWebsite;
    private readonly Dictionary<string, WebTabPane> _webTabs = [];
    private bool _syncingChannels;
    private static readonly AppPage[] ChannelPages = Enum.GetValues<AppPage>();
    private void SetupWorkspace()
    {
        var glyphs = new[] { "⌂", "☆", "▤", "▦", "↗", "≡", "⚑", "⇄", "⚙" };
        foreach (var page in ChannelPages)
        {
            var item = new ListBoxItem { Tag = page, Style = (Style)FindResource("WorkspaceChannel"), Margin = new Thickness(6, 2, 6, 2), Padding = new Thickness(12, 8, 12, 8) };
            var row = new StackPanel { Orientation = Orientation.Horizontal };
            var glyph = new TextBlock { Text = glyphs[Array.IndexOf(ChannelPages, page)], Width = 22, FontSize = 14, VerticalAlignment = VerticalAlignment.Center };
            glyph.SetResourceReference(TextBlock.ForegroundProperty, "TextFillColorSecondaryBrush");
            var title = new TextBlock { VerticalAlignment = VerticalAlignment.Center }; title.SetResourceReference(TextBlock.TextProperty, "Nav_" + page);
            row.Children.Add(glyph); row.Children.Add(title); item.Content = row; ChannelNav.Items.Add(item);
        }
        try { _workspace = new WebWorkspace(AppServices.DataDirectory.Path); }
        catch (Exception ex) when (ex is IOException or System.Text.Json.JsonException or ArgumentException)
        { AddWebsite.IsEnabled = false; AddWebsite.ToolTip = _loc["Web_Failed"]; }
        _loc.LanguageChanged += WorkspaceLanguageChanged;
        RebuildWebsiteRail(); MotionButton.IsChecked = _workspace?.ReduceMotion == true;
        AnimateTile(HomeWorkspace); AnimateTile(AddWebsite); AnimateTile(MotionButton);
        PreviewKeyDown += (_, e) =>
        {
            if ((Keyboard.Modifiers & ModifierKeys.Control) == 0) return;
            if (e.Key == Key.T) { EditWebsite(null); e.Handled = true; }
            if (e.Key == Key.L && _activeWebsite is { } id) { _webTabs[id].FocusAddress(); e.Handled = true; }
        };
        Closed += (_, _) => { _loc.LanguageChanged -= WorkspaceLanguageChanged; foreach (var pane in _webTabs.Values) pane.Dispose(); _webTabs.Clear(); };
    }
    private void WorkspaceLanguageChanged(object? sender, EventArgs e) => RebuildWebsiteRail();
    private void RebuildWebsiteRail()
    {
        WebsiteRail.Children.Clear();
        foreach (var tab in _workspace?.Tabs ?? [])
        {
            var tile = new ToggleButton { Content = tab.Glyph, Tag = tab.Id, IsChecked = tab.Id == _activeWebsite, Style = (Style)FindResource("WorkspaceTile"), ToolTip = tab.Name + "\n" + tab.Host };
            System.Windows.Automation.AutomationProperties.SetName(tile, tab.Name);
            tile.Click += (_, _) => OpenWebsite(tab); AnimateTile(tile);
            var menu = new ContextMenu(); var edit = new MenuItem(); edit.SetResourceReference(MenuItem.HeaderProperty, "Web_Edit"); edit.Click += (_, _) => EditWebsite(tab); menu.Items.Add(edit); tile.ContextMenu = menu;
            WebsiteRail.Children.Add(tile);
        }
        AddWebsite.IsEnabled = _workspace is not null && _workspace.Tabs.Count < WebWorkspace.MaximumTabs;
        AddWebsite.ToolTip = _loc[_workspace is null ? "Web_Failed" : AddWebsite.IsEnabled ? "Web_Add" : "Web_Limit"];
    }
    private bool ReducedMotion => _workspace?.ReduceMotion == true || !SystemParameters.ClientAreaAnimation;
    private void AnimateTile(ToggleButton tile)
    {
        var scale = new ScaleTransform(1, 1); tile.RenderTransform = scale; tile.RenderTransformOrigin = new Point(.5, .5);
        void Animate(double target)
        {
            var duration = TimeSpan.FromMilliseconds(ReducedMotion ? 0 : 160);
            var animation = new DoubleAnimation(target, duration) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
            scale.BeginAnimation(ScaleTransform.ScaleXProperty, animation); scale.BeginAnimation(ScaleTransform.ScaleYProperty, animation);
        }
        void Shape(bool hovered)
        {
            if (tile.Template?.FindName("Tile", tile) is Border shape)
                shape.BeginAnimation(Border.CornerRadiusProperty, new CornerRadiusAnimation(shape.CornerRadius, new CornerRadius(tile.IsChecked == true || hovered ? 14 : 22), TimeSpan.FromMilliseconds(ReducedMotion ? 0 : 160)));
            if (tile.Template?.FindName("Pill", tile) is Border pill)
            {
                var duration = TimeSpan.FromMilliseconds(ReducedMotion ? 0 : 160);
                pill.BeginAnimation(HeightProperty, new DoubleAnimation(tile.IsChecked == true ? 32 : 8, duration) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
                pill.BeginAnimation(OpacityProperty, new DoubleAnimation(tile.IsChecked == true || hovered ? 1 : 0, duration));
            }
        }
        tile.MouseEnter += (_, _) => { Animate(1.04); Shape(true); };
        tile.MouseLeave += (_, _) => { Animate(1); Shape(false); };
        tile.Checked += (_, _) => Shape(tile.IsMouseOver); tile.Unchecked += (_, _) => Shape(tile.IsMouseOver);
    }
    internal void OpenWebsite(WebWorkspaceTab tab)
    {
        if (!_webTabs.TryGetValue(tab.Id, out var pane))
        {
            pane = new WebTabPane(tab.Url); _webTabs[tab.Id] = pane;
            pane.EditRequested += () => EditWebsite(_workspace?.Tabs.FirstOrDefault(t => t.Id == tab.Id)); WebTabHost.Children.Add(pane);
        }
        _activeWebsite = tab.Id;
        // Detach the native page router: chart WebViews/activation loops receive their normal Unloaded lifecycle.
        NativePageHost.Children.Remove(RootNavigation); WebTabHost.Visibility = Visibility.Visible;
        foreach (var (id, view) in _webTabs) view.Visibility = id == tab.Id ? Visibility.Visible : Visibility.Collapsed;
        HomeWorkspace.IsChecked = false; _syncingChannels = true; ChannelNav.SelectedIndex = -1; _syncingChannels = false;
        foreach (var button in WebsiteRail.Children.OfType<ToggleButton>()) button.IsChecked = Equals(button.Tag, tab.Id);
    }
    private void ShowMarketWorkspace()
    {
        _activeWebsite = null; WebTabHost.Visibility = Visibility.Collapsed; HomeWorkspace.IsChecked = true;
        if (!NativePageHost.Children.Contains(RootNavigation)) NativePageHost.Children.Add(RootNavigation);
        foreach (var button in WebsiteRail.Children.OfType<ToggleButton>()) button.IsChecked = false;
    }
    private void SyncMarketNavigation()
    {
        ShowMarketWorkspace(); _syncingChannels = true;
        ChannelNav.SelectedIndex = Array.FindIndex(ChannelPages, p => PageType(p) == _currentPage?.GetType()); _syncingChannels = false;
    }
    private void OnChannelSelected(object sender, SelectionChangedEventArgs e)
    {
        if (_syncingChannels || ChannelNav.SelectedItem is not ListBoxItem { Tag: AppPage page }) return;
        ShowMarketWorkspace(); RootNavigation.Navigate(PageType(page));
    }
    private void OnHomeWorkspace(object sender, RoutedEventArgs e) => SyncMarketNavigation();
    private void OnAddWebsite(object sender, RoutedEventArgs e) { AddWebsite.IsChecked = false; EditWebsite(null); }
    private void OnToggleMotion(object sender, RoutedEventArgs e)
    {
        try { _workspace?.SetReduceMotion(MotionButton.IsChecked == true); }
        catch (IOException) { MotionButton.IsChecked = _workspace?.ReduceMotion == true; MotionButton.ToolTip = _loc["Web_Failed"]; }
    }
    internal void EditWebsite(WebWorkspaceTab? tab)
    {
        if (_workspace is null) return;
        var dialog = new Window { Owner = this, Title = _loc[tab is null ? "Web_Add" : "Web_Edit"], Width = 440, MinWidth = 400, SizeToContent = SizeToContent.Height, ResizeMode = ResizeMode.NoResize, WindowStartupLocation = WindowStartupLocation.CenterOwner, FontSize = 14 };
        dialog.SetResourceReference(BackgroundProperty, "ApplicationBackgroundBrush"); dialog.SetResourceReference(ForegroundProperty, "TextFillColorPrimaryBrush");
        var body = new StackPanel { Margin = new Thickness(24) };
        var name = new TextBox { Text = tab?.Name ?? "", MaxLength = 40, Name = "WebsiteName", Padding = new Thickness(8), Margin = new Thickness(0, 6, 0, 12) };
        var url = new TextBox { Text = tab?.Url ?? "", MaxLength = 2048, Name = "WebsiteAddress", Padding = new Thickness(8), Margin = new Thickness(0, 6, 0, 12) };
        var error = new TextBlock { Visibility = Visibility.Collapsed, TextWrapping = TextWrapping.Wrap, FontSize = 12, Margin = new Thickness(0, 8, 0, 8) };
        body.Children.Add(new TextBlock { Text = _loc["Web_Name"] }); body.Children.Add(name); body.Children.Add(new TextBlock { Text = _loc["Web_Address"] }); body.Children.Add(url);
        System.Windows.Automation.AutomationProperties.SetName(name, _loc["Web_Name"]); System.Windows.Automation.AutomationProperties.SetName(url, _loc["Web_Address"]);
        body.Children.Add(new TextBlock { Text = _loc["Web_Privacy"], TextWrapping = TextWrapping.Wrap, FontSize = 12 }); body.Children.Add(error);
        var actions = new WrapPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 16, 0, 0) }; body.Children.Add(actions);
        Button Button(string key, Action action) { var button = new Button { Content = _loc[key], Padding = new Thickness(12, 6, 12, 6), Margin = new Thickness(0, 0, 8, 8) }; button.Click += (_, _) => action(); actions.Children.Add(button); return button; }
        void Fail(string key) { error.Text = _loc[key]; error.Visibility = Visibility.Visible; }
        void Save()
        {
            if (!WebWorkspace.TryNormalize(name.Text, url.Text, out _, out _)) { Fail("Web_Invalid"); return; }
            try
            {
                var saved = _workspace.Save(tab?.Id, name.Text, url.Text);
                if (tab is not null && tab.Url != saved.Url && _webTabs.Remove(tab.Id, out var old)) { WebTabHost.Children.Remove(old); old.Dispose(); }
                RebuildWebsiteRail(); OpenWebsite(saved); dialog.Close();
            }
            catch (Exception ex) when (ex is IOException or InvalidOperationException or ArgumentException) { Fail("Web_Failed"); }
        }
        Button("Web_Save", Save); Button("Web_Cancel", () => dialog.Close());
        if (tab is not null)
        {
            void Move(int delta) { try { _workspace.Move(tab.Id, delta); RebuildWebsiteRail(); } catch (IOException) { Fail("Web_Failed"); } }
            Button("Web_Up", () => Move(-1)); Button("Web_Down", () => Move(1));
            Button? remove = null; var confirmed = false;
            remove = Button("Web_Remove", () =>
            {
                if (!confirmed) { confirmed = true; remove!.Content = _loc["Web_ConfirmRemove"]; return; }
                try { _workspace.Remove(tab.Id); if (_webTabs.Remove(tab.Id, out var old)) { WebTabHost.Children.Remove(old); old.Dispose(); } if (_activeWebsite == tab.Id) SyncMarketNavigation(); RebuildWebsiteRail(); dialog.Close(); }
                catch (IOException) { Fail("Web_Failed"); }
            });
        }
        dialog.Content = body; dialog.PreviewKeyDown += (_, e) => { if (e.Key == Key.Escape) { dialog.Close(); e.Handled = true; } if (e.Key == Key.Enter && (name.IsKeyboardFocusWithin || url.IsKeyboardFocusWithin)) { Save(); e.Handled = true; } };
        dialog.Loaded += (_, _) => name.Focus(); dialog.ShowDialog(); AddWebsite.Focus();
    }
}
