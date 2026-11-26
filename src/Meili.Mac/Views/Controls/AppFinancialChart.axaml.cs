using Avalonia.Controls;
namespace Meili.Mac.Views.Controls;
/// <summary>Shared chart presentation for actual/estimated signed values; keyboard-focusable exact values.</summary>
public partial class AppFinancialChart : UserControl
{
    public AppFinancialChart()
    {
        InitializeComponent();
        GotFocus += (_,e)=>ShowDetail(e.Source as Button);
    }
    private void OnPointSelected(object? sender,Avalonia.Interactivity.RoutedEventArgs e)=>ShowDetail(sender as Button);
    private void ShowDetail(Button? button)
    {
        if(button?.DataContext is not Meili.Shared.ViewModels.FinancialChartPoint point)return;
        PointDetails.Text=point.Detail;PointDetails.IsVisible=true;
        AppMotion.Enter(PointDetails);
    }
}
