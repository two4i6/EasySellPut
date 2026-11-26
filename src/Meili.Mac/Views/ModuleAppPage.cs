using Avalonia.Controls;
using Meili.Mac.Platform;
using Meili.Automation;
using Meili.Automation.Modules;
using Meili.Mac.Views.Controls;
namespace Meili.Mac.Views;
public sealed class ModuleAppPage(string appId):UserControl
{
    private IPrivateAppSession? session;
    private void PresentationChanged(object? sender,EventArgs e)=>(session as PrivateAppSession)?.UpdatePresentation(AppViewPresentation.Create(MacChartPalette.Current(AppServices.Get<MacTheme>().IsDark)));
    private CancellationTokenSource? pending;
    protected override async void OnAttachedToVisualTree(Avalonia.VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);if(pending is not null)return;var owner=new CancellationTokenSource();pending=owner;Content=new AppLoading();
        try
        {
            var created=await PrivateAppSession.CreateAsync(AppServices.DataDirectory.Path,appId,AppServices.Get<IOperationDispatcher>(),true,owner.Token);
            if(pending!=owner||owner.IsCancellationRequested){created.Dispose();return;}
            session=created;Ui.Platform.ColorsChanged+=PresentationChanged;DesignMotion.Changed+=PresentationChanged;LocalizationService.Current.LanguageChanged+=PresentationChanged;PresentationChanged(null,EventArgs.Empty);Content=new PrivateAppView(created);
        }
        catch(OperationCanceledException){}
        catch(Exception ex){Meili.Core.Diagnostics.AppLog.Warn("app-view","Application page failed",ex);if(pending==owner){Stop();Content=new TextBlock{Text=LocalizationService.Current["Apps_Error"],TextWrapping=Avalonia.Media.TextWrapping.Wrap,Margin=new Avalonia.Thickness(24)};}}
    }
    private void Stop()
    {Ui.Platform.ColorsChanged-=PresentationChanged;DesignMotion.Changed-=PresentationChanged;LocalizationService.Current.LanguageChanged-=PresentationChanged;pending?.Cancel();pending?.Dispose();pending=null;(Content as IDisposable)?.Dispose();Content=null;session?.Dispose();session=null;}
    protected override void OnDetachedFromVisualTree(Avalonia.VisualTreeAttachmentEventArgs e){Stop();base.OnDetachedFromVisualTree(e);}
}
