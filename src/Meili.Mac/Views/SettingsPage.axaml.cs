using Avalonia.Controls;

namespace Meili.Mac.Views;

public partial class SettingsPage : UserControl
{
    public SettingsPage()
    {
        InitializeComponent();
        var vm = AppServices.Get<SettingsViewModel>();
        DataContext = vm;
        Loaded += async (_, _) =>
        {
            if (DataContext is SettingsViewModel model && model.RefreshCacheCommand.CanExecute(null))
                await model.RefreshCacheCommand.ExecuteAsync(null);
        };

    }
}
