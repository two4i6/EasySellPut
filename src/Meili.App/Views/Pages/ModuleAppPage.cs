using System.Windows;
using System.Windows.Controls;
using Meili.App.Services;
using Meili.App.Views.Controls;
using Meili.Automation;
using Meili.Automation.Modules;
namespace Meili.App.Views.Pages;
public sealed class ModuleAppPage:UserControl
{
    private readonly string appId;
    private IPrivateAppSession? session;
    private void PresentationChanged(object? sender,EventArgs e)=>(session as PrivateAppSession)?.UpdatePresentation(AppViewPresentation.Create(WpfChartPalette.Current(AppServices.Get<ThemeService>().IsDark)));
    private PrivateAppView? browser;
    private CancellationTokenSource? pending;
    public ModuleAppPage(string appId){this.appId=appId;Loaded+=async(_,_)=>await Start();Unloaded+=(_,_)=>Stop();}
    private async Task Start()
    {
        if(pending is not null)return;var owner=new CancellationTokenSource();pending=owner;Content=new AppLoading();
        try
        {
            var created=await PrivateAppSession.CreateAsync(AppServices.DataDirectory.Path,appId,AppServices.Get<IOperationDispatcher>(),true,owner.Token);
            if(pending!=owner||owner.IsCancellationRequested){created.Dispose();return;}
            session=created;ThemeService.ColorsChanged+=PresentationChanged;DesignMotion.Changed+=PresentationChanged;LocalizationService.Current.LanguageChanged+=PresentationChanged;PresentationChanged(null,EventArgs.Empty);var view=new PrivateAppView();browser=view;Content=view;
            await view.NavigateAsync(created,System.IO.Path.Combine(AppServices.DataDirectory.Path,"browser","apps",appId),owner.Token);
        }
        catch(OperationCanceledException){}
        catch(Exception ex){Meili.Core.Diagnostics.AppLog.Warn("app-view","Application page failed",ex);if(pending==owner){Stop();Content=new TextBlock{Text=LocalizationService.Current["Apps_Error"],TextWrapping=TextWrapping.Wrap,Margin=new Thickness(24)};}}
    }
    private void Stop(){ThemeService.ColorsChanged-=PresentationChanged;DesignMotion.Changed-=PresentationChanged;LocalizationService.Current.LanguageChanged-=PresentationChanged;pending?.Cancel();pending?.Dispose();pending=null;browser?.Dispose();browser=null;Content=null;session?.Dispose();session=null;}
}
