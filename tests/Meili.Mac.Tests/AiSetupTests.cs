using Avalonia.Controls;
using Avalonia.VisualTree;
using Avalonia.Headless.XUnit;
using Meili.Mac.Views;

namespace Meili.Mac.Tests;
public sealed class AiSetupTests
{
    [AvaloniaFact]
    public void Connection_entry_is_localized_and_alternatives_start_collapsed()
    {
        MacHost.EnsureComposed();var page=new SettingsPage();var window=new Window{Width=480,Height=800,Content=page};window.Show();MacHost.Pump();
        var loc=AppServices.Get<LocalizationService>();var original=loc.Language;
        try
        {
            foreach(var language in new[]{"zh-CN","en-US"})
            {
                loc.Apply(language);MacHost.Pump();
                var button=page.FindControl<Button>("ConnectCodex")!;
                Assert.False(page.GetVisualDescendants().OfType<Expander>().Single(e=>Equals(e.Header,loc["Set_AiMore"])).IsExpanded);
                Assert.Equal(loc["Set_AiCodex"],button.Content);Assert.False(button.IsEnabled); // source test host does not bundle CLI
                Assert.Equal(loc["Set_AiMissing"],((Meili.Shared.ViewModels.SettingsViewModel)page.DataContext!).AiConnectionStatus);
            }
        }
        finally{loc.Apply(original);window.Close();}
    }
}
