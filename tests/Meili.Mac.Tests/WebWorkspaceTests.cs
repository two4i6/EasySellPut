using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Meili.Core.Settings;
using Meili.Mac.Platform;

namespace Meili.Mac.Tests;

public sealed class WebWorkspaceTests
{
    private static void Click(Button button) => button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    [AvaloniaFact]
    public async Task Website_editor_persists_tabs_and_switching_preserves_attached_browser()
    {
        MacHost.EnsureComposed();
        var workspace = new WebWorkspace(MacHost.DataDir);
        foreach (var tab in workspace.Tabs.ToList()) workspace.Remove(tab.Id);
        var w = new MainWindow(); w.Show(); MacHost.Pump();
        try
        {
            var editing = w.EditWebsite(null); MacHost.Pump(); var dialog = w.OwnedWindows.Single();
            var inputs = dialog.GetVisualDescendants().OfType<TextBox>().ToList();
            inputs.Single(t => t.Name == "WebsiteName").Text = "测试网页";
            inputs.Single(t => t.Name == "WebsiteAddress").Text = "file:///tmp/blocked";
            var save = dialog.GetVisualDescendants().OfType<Button>().Single(b => Equals(b.Content, LocalizationService.Current["Web_Save"]));
            Click(save); MacHost.Pump(); Assert.True(dialog.IsVisible);
            Assert.Contains(dialog.GetVisualDescendants().OfType<TextBlock>(), t => t.Text == LocalizationService.Current["Web_Invalid"] && t.IsVisible);
            inputs.Single(t => t.Name == "WebsiteAddress").Text = "https://example.com/";
            Click(save); MacHost.Pump(); await editing;
            var saved = Assert.Single(new WebWorkspace(MacHost.DataDir).Tabs);
            var browser = Assert.Single(w.GetVisualDescendants().OfType<WebTabPane>());
            w.Navigate(AppPage.Dashboard); MacHost.Pump(); Assert.False(browser.IsEffectivelyVisible);
            w.OpenWebsite(saved); MacHost.Pump(); Assert.Same(browser, Assert.Single(w.GetVisualDescendants().OfType<WebTabPane>()));
            var wizard = w.WizardVisible; w.KeyTextInput("A"); MacHost.Pump(); Assert.Equal(wizard, w.WizardVisible);
            w.Navigate(AppPage.Dashboard); MacHost.Pump();
            Assert.True(w.GetVisualDescendants().OfType<ToggleButton>().Single(t => t.Name == "HomeWorkspace").IsChecked);
        }
        finally { w.Close(); var clean = new WebWorkspace(MacHost.DataDir); foreach (var t in clean.Tabs.ToList()) clean.Remove(t.Id); }
    }
    [AvaloniaFact]
    public async Task Workspace_screenshots_cover_languages_themes_and_editor()
    {
        MacHost.EnsureComposed(); var store = new WebWorkspace(MacHost.DataDir);
        foreach (var t in store.Tabs.ToList()) store.Remove(t.Id);
        store.Save(null, "Financial Times · 测试网页", "https://www.ft.com/"); store.Save(null, "Reuters · 测试网页", "https://www.reuters.com/");
        var loc = LocalizationService.Current; var theme = AppServices.Get<MacTheme>(); var w = new MainWindow(); w.Show();
        try
        {
            theme.Apply(AppThemeMode.Dark); loc.Apply("zh-CN"); w.Navigate(AppPage.Dashboard); MacHost.Pump(); MacHost.Save(w, "discord-workspace-dark");
            var editing = w.EditWebsite(null); MacHost.Pump(); var editor = w.OwnedWindows.Single(); MacHost.Save(editor, "discord-workspace-add"); editor.Close(); await editing;
            theme.Apply(AppThemeMode.Light); loc.Apply("en-US"); w.Width = 980; MacHost.Pump(); MacHost.Save(w, "discord-workspace-light-compact");
            var motion = w.GetVisualDescendants().OfType<ToggleButton>().Single(t => t.Name == "MotionButton"); motion.IsChecked = true; Click(motion); MacHost.Pump(); Assert.Contains("ReducedMotion", w.Classes);
        }
        finally { w.Close(); var clean = new WebWorkspace(MacHost.DataDir); foreach (var t in clean.Tabs.ToList()) clean.Remove(t.Id); clean.SetReduceMotion(false); theme.Apply(AppThemeMode.System); loc.Apply("zh-CN"); }
    }
}
