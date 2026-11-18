using System.Windows.Controls;
namespace Meili.App.Views.Controls;
/// <summary>Shared chart presentation for actual/estimated signed values; keyboard-focusable exact values.</summary>
public partial class AppFinancialChart : UserControl
{
    public AppFinancialChart()
    {
        InitializeComponent();
        GotKeyboardFocus += (_,e)=>ShowDetail(e.NewFocus as Button);
    }
    private void OnPointSelected(object? sender,System.Windows.RoutedEventArgs e)=>ShowDetail(sender as Button);
    private void ShowDetail(Button? button)
    {
        if(button?.DataContext is not Meili.Shared.ViewModels.FinancialChartPoint point)return;
        PointDetails.Text=point.Detail;PointDetails.Visibility=System.Windows.Visibility.Visible;
        ComponentMotion.Enter(PointDetails);
    }
}
