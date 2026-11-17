using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Meili.Core.Models;
using Meili.Core.Quotes;
using Meili.Core.Settings;
using Meili.Core.Time;
using Meili.Data;
using Meili.Data.Http;
using Meili.Data.Providers.Yahoo;
using Meili.Mac.Platform;
namespace Meili.Mac.Tests;

public sealed class OvernightLiveTests
{
    [AvaloniaFact][Trait("Category","Live")]
    public async Task Actual_Yahoo_overnight_updates_reach_native_hero_and_mini_graphs()
    {
        Assert.SkipWhen(Environment.GetEnvironmentVariable("MEILI_LIVE")!="1", "Real Yahoo acceptance requires MEILI_LIVE=1.");
        Assert.SkipWhen(MarketClock.ToEastern(DateTimeOffset.UtcNow).Hour is >=4 and <20, "Requires actual 20:00–04:00 Eastern overnight source updates.");
        MacHost.EnsureComposed();var loc=LocalizationService.Current;loc.Apply("zh-CN");var theme=AppServices.Get<MacTheme>();theme.Apply(AppThemeMode.Dark);
        using var stop=new CancellationTokenSource(TimeSpan.FromSeconds(130));
        var settings=new NetworkSettings{RequestTimeoutSeconds=8,MaxRetries=0};var proxy=await ProxyDetector.ResolveAsync(settings,stop.Token);
        using var data=new DataServices(settings,proxy);var hub=new QuoteHub(data.Router);var context=new SymbolContext();context.Set("QQQ");
        using var model=new QuotePanelViewModel(hub,data.Router,new WatchlistStore(new(Path.Combine(MacHost.DataDir,"real-night-"+Guid.NewGuid()))),context,loc);
        var panel=new QuotePanelWindow(model,_=>{},()=>{},()=>{});var began=DateTimeOffset.UtcNow;var received=0;var errors=new List<string>();
        try
        {
            await panel.ShowPanelAsync();MacHost.Pump();var stream=new QuoteStreamingService(new YahooQuoteStream(data.Gateway));
            try
            {
                await foreach(var tick in stream.WatchAsync(model.Rows.Select(r=>r.Symbol).ToArray(),errors.Add,stop.Token))
                {
                    hub.ApplyTicks([tick]);MacHost.Pump();if(tick.Symbol=="QQQ"&&tick.Session==MarketState.Overnight)received++;
                    if(DateTimeOffset.UtcNow-began>TimeSpan.FromSeconds(80)&&model.Selected!.Graph.Points.Count>=2)break;
                }
            }
            catch(OperationCanceledException)when(stop.IsCancellationRequested){}
            MacHost.Pump();var row=model.Selected!;var output=Environment.GetEnvironmentVariable("MEILI_RENDER_DIR");
            if(output is not null)
            {
                Directory.CreateDirectory(output);var graph=row.Graph;var report=new{live=true,source="yahoo",began,ended=DateTimeOffset.UtcNow,received,errors,symbol=row.Symbol,regularPrice=row.Quote?.Price,price=row.Display?.Snapshot.Price,sourceTime=row.Display?.Snapshot.AsOf,session=row.Display?.Session.ToString(),graph.Day,chartSource=graph.Source,graph.AsOf,graph.WindowStart,graph.WindowEnd,points=graph.Points.Count,hasPriceBaseline=graph.Baseline is not null,coverage="Actually received overnight segment, not certified complete 20:00–04:00 history."};
                await File.WriteAllTextAsync(Path.Combine(output,"live-overnight.json"),System.Text.Json.JsonSerializer.Serialize(report));MacHost.Save(panel,"glance-night-live");
                var body=(Control)panel.Content!;panel.Content=null;
                var scene=new Window{Width=1920,Height=1080,Background=(Avalonia.Media.IBrush)Ui.Platform.Resource("ApplicationBackgroundBrush")!};
                var canvas=new Grid();scene.Content=canvas;
                canvas.Children.Add(new TextBlock{Text="真实 Yahoo 夜盘推送 · 控件验收场景（非操作系统截图）",FontSize=18,Margin=new Avalonia.Thickness(32),Foreground=(Avalonia.Media.IBrush)Ui.Platform.Resource("TextFillColorPrimaryBrush")!});
                body.Width=panel.Width;body.Height=panel.Height;body.HorizontalAlignment=Avalonia.Layout.HorizontalAlignment.Right;body.VerticalAlignment=Avalonia.Layout.VerticalAlignment.Top;body.Margin=new Avalonia.Thickness(0,24,24,0);canvas.Children.Add(body);
                try{scene.Show();MacHost.Pump();MacHost.Save(scene,"night-live-1080p");}
                finally{canvas.Children.Remove(body);scene.Close();panel.Content=body;}
            }
            Assert.True(received>0);Assert.Equal(MarketSession.Overnight,row.Display!.Session);Assert.True(row.Graph.Points.Count>=2);Assert.Equal("yahoo",row.Graph.Source);Assert.True(row.ChartObserved);
            panel.HidePanel();Assert.Empty(hub.SubscribedSymbols);
        }
        finally{panel.Close();loc.Apply("zh-CN");theme.Apply(AppThemeMode.System);}
    }
}
