using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Meili.App.Services;

namespace Meili.App.Views.Pages;

public partial class NewsPage : Page
{
    internal System.Windows.FrameworkElement FundamentalsContent=>FundamentalsPane;
    public NewsPage()
    {
        InitializeComponent();
        var vm = AppServices.Get<NewsViewModel>();
        DataContext = vm;
        NewsWorkspace.Children.Remove(FundamentalsPane);
        FundamentalsPane.DataContext=vm;
        FundamentalsPane.Margin=new(24);
        Loaded += async (_, _) =>
        {
            HighlightPeriodButtons();
            await vm.ActivateAsync();
        };
        Unloaded += (_, _) => vm.Deactivate();
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName is nameof(NewsViewModel.Annual))
                Dispatcher.Invoke(HighlightPeriodButtons);
        };
    }

    private NewsViewModel Vm => (NewsViewModel)DataContext;


    private void OnPeriodClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { Tag: string tag })
            Vm.SelectAnnualCommand.Execute(tag == "annual");
    }

    private void OnNewsKeyDown(object sender,KeyEventArgs e)
    {
        if(e.Key==Key.Enter && NewsList.SelectedItem is NewsEntry item){Vm.OpenArticleCommand.Execute(item);e.Handled=true;}
    }

    private void OnNewsDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (NewsList.SelectedItem is NewsEntry item)
            Vm.OpenArticleCommand.Execute(item);
    }

    private void HighlightPeriodButtons()
    {
        foreach (var child in FindButtons(FundamentalsPane))
        {
            if (child.Tag is not string tag || (tag != "annual" && tag != "quarterly")) continue;
            var on = tag == "annual" ? Vm.Annual : !Vm.Annual;
            child.SetResourceReference(Control.BackgroundProperty, on ? "AccentFillColorDefaultBrush" : "ControlFillColorSecondaryBrush");
            child.SetResourceReference(Control.ForegroundProperty, on ? "TextOnAccentFillColorPrimaryBrush" : "TextFillColorPrimaryBrush");
        }
    }

    private static IEnumerable<Button> FindButtons(DependencyObject root)
    {
        var n = VisualTreeHelper.GetChildrenCount(root);
        for (int i = 0; i < n; i++)
        {
            var c = VisualTreeHelper.GetChild(root, i);
            if (c is Button b) yield return b;
            foreach (var x in FindButtons(c)) yield return x;
        }
    }
}