using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Meili.App.Services;
using Meili.App.Views.Controls;
namespace Meili.App;
public partial class MainWindow
{
    private ArticleSplitView? _newsSplit;
    private ArticleSplitView? _articleTarget;
    private WebTabPane? _articleReader;
    private IInputElement? _newsFocus;
    internal ArticleSplitView? NewsSplit=>_newsSplit;
    private void ConfigureNewsDefault(FrameworkElement? content)
    {
        if(_newsSplit is null)return;
        if(content is null && _newsSplit.HasDefaultSupplement && _articleReader is not null)CloseNewsArticle();
        var opening=content is not null && !_newsSplit.HasDefaultSupplement;
        _newsSplit.SetDefaultSupplement(content);
        if(_articleReader is null)_newsSplit.Close();
        if(opening)
        {
            _newsSplit.ColumnDefinitions[0].Width=new System.Windows.GridLength(3,System.Windows.GridUnitType.Star);
            _newsSplit.ColumnDefinitions[2].Width=new System.Windows.GridLength(4,System.Windows.GridUnitType.Star);
        }
    }
    private void SetupNewsSplit()
    {
        WorkspaceGrid.Children.Remove(NativePageHost);WorkspaceGrid.Children.Remove(WebTabHost);
        Grid.SetColumn(NativePageHost,0);Grid.SetColumn(WebTabHost,0);
        var main=new Grid();main.Children.Add(NativePageHost);main.Children.Add(WebTabHost);
        _newsSplit=new ArticleSplitView(main);Grid.SetColumn(_newsSplit,1);WorkspaceGrid.Children.Add(_newsSplit);
        PreviewKeyDown+=(_,e)=>{if(e.Key==Key.Escape&&_articleReader is not null){CloseNewsArticle();e.Handled=true;}};
        Closed+=(_,_)=>CloseNewsArticle();
    }
    public void OpenNewsArticle(string url,string title)
    {
        if(!NewsReaderPolicy.IsAllowed(url))throw new ArgumentException("Unsupported article URL",nameof(url));
        if(!IsVisible||WindowState==WindowState.Minimized)AppServices.Get<NotificationService>().Restore(this);
        if(_articleReader is null)
        {
            _newsFocus=Keyboard.FocusedElement;
            _articleReader=new WebTabPane(url,articleMode:true);
            _articleReader.CloseRequested+=CloseNewsArticle;
        }
        else _articleReader.OpenArticle(url);
        System.Windows.Automation.AutomationProperties.SetName(_articleReader,title);
        _articleTarget=_newsSplit;
        _articleTarget!.Open(_articleReader);
    }
    public void CloseNewsArticle()
    {
        if(_articleReader is null)return;
        _articleReader.CloseRequested-=CloseNewsArticle;
        _articleReader.Dispose();
        _articleTarget?.Close();_articleTarget=null;_articleReader=null;
        if(IsVisible&&_newsFocus is UIElement {IsVisible:true} focus)focus.Focus();
        _newsFocus=null;
    }
}
