using Avalonia.Controls;
using Avalonia.Input;

namespace Meili.Mac.Views;

public partial class NewsPage : UserControl
{
    internal Avalonia.Controls.Control FundamentalsContent=>FundamentalsPane;
    public NewsPage()
    {
        InitializeComponent();
        var vm = AppServices.Get<NewsViewModel>();
        DataContext = vm;
        NewsWorkspace.Children.Remove(FundamentalsPane);
        FundamentalsPane.DataContext=vm;
        FundamentalsPane.Margin=new(24);
        AnnualChip.CommandParameter = true;      // the command takes a bool, not the XAML string
        QuarterlyChip.CommandParameter = false;
        PageLife.Bind(this, vm.ActivateAsync, vm.Deactivate);
        NewsList.KeyDown += (_,e)=>
        {
            if(e.Key==Key.Enter && NewsList.SelectedItem is NewsEntry item){vm.OpenArticleCommand.Execute(item);e.Handled=true;}
        };
        NewsList.DoubleTapped += (_, _) =>
        {
            if (NewsList.SelectedItem is NewsEntry item) vm.OpenArticleCommand.Execute(item);
        };
    }
}
