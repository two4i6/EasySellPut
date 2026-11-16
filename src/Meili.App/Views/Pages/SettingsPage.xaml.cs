using System.Windows.Controls;
using Meili.App.Services;

namespace Meili.App.Views.Pages;

public partial class SettingsPage : Page
{
    public SettingsPage()
    {
        InitializeComponent();
        DataContext = AppServices.Get<SettingsViewModel>();
        Loaded += async (_, _) =>
        {
            if (DataContext is SettingsViewModel model && model.RefreshCacheCommand.CanExecute(null))
                await model.RefreshCacheCommand.ExecuteAsync(null);
        };
    }
}
