using Meili.Core.Diagnostics;
using System.Text.Json;
using Meili.Automation;
using Meili.Core.Abstractions;
namespace Meili.Shared.Services;

/// <summary>One visible workbench capture loop; disposal cancels both provider I/O and model process.</summary>
public sealed class QqqGexActivity(IMarketDataService market,string directory,DesktopActivity activity) : IDisposable
{
    private readonly CancellationTokenSource stop=new();
    public event Action? Published;
    public string Status {get;private set;}="idle";
    private int started;
    public void Start(){if(Interlocked.Exchange(ref started,1)==0)_ = Task.Run(Run);}
    private async Task Run()
    {
        try {
            while(!stop.IsCancellationRequested)
            {
                if(activity.AnyVisible)
                try{
                    var result=await new QqqGexCaptureService(market,directory).CaptureAsync(stop.Token);
                    using var capture=JsonSerializer.SerializeToDocument(result);Status=capture.RootElement.GetProperty("status").GetString()!;
                    if(Status=="captured_input"){
                        var computed=await QqqGexCalculationRunner.RunAsync(directory,stop.Token);using var json=JsonSerializer.SerializeToDocument(computed);Status=json.RootElement.GetProperty("status").GetString()!;
                        if(Status is "imported" or "partial"&&!stop.IsCancellationRequested)Ui.Platform.Run(()=>{if(!stop.IsCancellationRequested)Published?.Invoke();});
                    }
                }catch(OperationCanceledException)when(!stop.IsCancellationRequested){Status="source_timeout";AppLog.Warn("qqq-gex","Source deadline reached; next capture remains scheduled");}
                catch(Exception ex) when(ex is not OperationCanceledException){Status=ex.GetType().Name;AppLog.Warn("qqq-gex","Capture/calculation failed: "+Status);}
                await Task.Delay(TimeSpan.FromMinutes(2),stop.Token);
            }
        }catch(OperationCanceledException) when(stop.IsCancellationRequested){}
    }
    public void Dispose()=>stop.Cancel();
}
