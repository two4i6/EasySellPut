using Meili.Core.Diagnostics;
using System.Text.Json;
using Meili.Automation;
using Meili.Core.Abstractions;
namespace Meili.Shared.Services;

public sealed record QqqGexCaptureState(string Phase,DateTimeOffset? StartedAt=null,DateTimeOffset? UpdatedAt=null,DateTimeOffset? SourceMarketAt=null,int? DelayMinutes=null,int? MissingIv=null,int? CapturedExpiries=null,bool? InputComplete=null);
/// <summary>Visible workbench demand. Captured input, calculation and readable publication are separate states.</summary>
public sealed class QqqGexActivity(IMarketDataService market,string directory,DesktopActivity activity) : IDisposable
{
    private readonly CancellationTokenSource stop=new();
    private readonly SemaphoreSlim wake=new(0,1);
    private QqqGexCaptureState state=new("idle");
    public QqqGexCaptureState State=>Volatile.Read(ref state);
    public string Status=>State.Phase;
    public event Action? Published;
    public event Action? StateChanged;
    private int started;
    private void Update(QqqGexCaptureState value){Volatile.Write(ref state,value with{UpdatedAt=DateTimeOffset.UtcNow});StateChanged?.Invoke();}
    private void VisibilityChanged(object? sender,EventArgs e){if(activity.AnyVisible)try{wake.Release();}catch(SemaphoreFullException){}}
    public void Start(){if(Interlocked.Exchange(ref started,1)==0){activity.Changed+=VisibilityChanged;_ = Task.Run(Run);}}
    private async Task Run()
    {
        try {
            while(!stop.IsCancellationRequested)
            {
                var began=System.Diagnostics.Stopwatch.StartNew();var visible=activity.AnyVisible;
                if(visible)
                try{
                    Update(State with{Phase="capturing",StartedAt=DateTimeOffset.UtcNow});
                    var bootstrap=!new Meili.Data.Cache.QqqGexResponseStore(Path.Combine(directory,"cache","qqq-gex.db")).HasLocalHistory();
                    if(bootstrap){await CaptureAndPublish(false,false);if(Status is "imported" or "partial")await CaptureAndPublish(true,true);}
                    else await CaptureAndPublish(true,false);
                }catch(OperationCanceledException)when(!stop.IsCancellationRequested){Update(State with{Phase="source_timeout"});AppLog.Warn("qqq-gex","Source deadline reached; next capture remains scheduled");}
                catch(Exception ex) when(ex is not OperationCanceledException){Update(State with{Phase="failed"});AppLog.Warn("qqq-gex","Capture/calculation failed: "+ex.GetType().Name);}
                else Update(State with{Phase="paused"});
                if(visible)while(wake.Wait(0)){}
                var remaining=TimeSpan.FromMinutes(2)-began.Elapsed;
                await wake.WaitAsync(remaining>TimeSpan.Zero?remaining:TimeSpan.FromSeconds(1),stop.Token);
            }
        }catch(OperationCanceledException) when(stop.IsCancellationRequested){}
    }
    private async Task CaptureAndPublish(bool includeContext,bool enriching)
    {
                    Update(State with{Phase=enriching?"enriching":"capturing",StartedAt=State.StartedAt??DateTimeOffset.UtcNow});
                    var result=await new QqqGexCaptureService(market,directory).CaptureAsync(stop.Token,includeContext);
                    using var capture=JsonSerializer.SerializeToDocument(result);var raw=capture.RootElement;
                    var phase=raw.GetProperty("status").GetString()!;
                    DateTimeOffset? at=raw.TryGetProperty("sourceMarketAt",out var time)&&time.ValueKind==JsonValueKind.String&&time.TryGetDateTimeOffset(out var parsed)?parsed:null;
                    int? Number(string key)=>raw.TryGetProperty(key,out var value)&&value.ValueKind==JsonValueKind.Number&&value.TryGetInt32(out var number)?number:null;
                    Update(State with{Phase=phase,SourceMarketAt=at,DelayMinutes=Number("sourceDelayMinutes"),MissingIv=Number("missingIv"),CapturedExpiries=Number("capturedExpiries")});
                    if(phase=="captured_input"){
                        Update(State with{Phase="calculating"});
                        var computed=await QqqGexCalculationRunner.RunAsync(directory,stop.Token);using var json=JsonSerializer.SerializeToDocument(computed);var data=json.RootElement;
                        phase=data.GetProperty("status").GetString()!;bool? complete=data.TryGetProperty("inputComplete",out var quality)&&quality.ValueKind is JsonValueKind.True or JsonValueKind.False?quality.GetBoolean():null;
                        Update(State with{Phase=phase,InputComplete=complete});
                        if(phase is "imported" or "partial"&&!stop.IsCancellationRequested)Ui.Platform.Run(()=>{if(!stop.IsCancellationRequested)Published?.Invoke();});
                    }
    }
    public void Dispose(){activity.Changed-=VisibilityChanged;stop.Cancel();}
}
