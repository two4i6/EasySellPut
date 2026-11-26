using Meili.Core.Diagnostics;
using Meili.Core.Quotes;
using Meili.Core.Settings;
using Meili.Core.Time;
using Meili.Core.Models;
namespace Meili.Shared.Services;

/// <summary>The only quote timer. No subscribers means no wakeups; passive background quotes use 30s, alerts keep 5/10/60s.</summary>
public sealed class QuotePump : IDisposable
{
    private readonly QuoteHub _hub;
    private readonly QuoteStreamingService? _stream;
    private CancellationTokenSource? _streamStop;
    private string _streamKey="";
    private long _streamEpoch;
    private Task _streamTask=Task.CompletedTask;
    private readonly object _pendingGate=new();
    private readonly Dictionary<string,QuoteTick> _pending=new(StringComparer.OrdinalIgnoreCase);
    private DateTimeOffset _nextPoll;
    private long _lastStreamTick;private readonly IUiTimer _timer=Ui.Timer();
    private readonly bool _alertCadence;private readonly DesktopActivity? _activity;private readonly AlertStore? _alerts;
    private readonly CancellationTokenSource _lifetime=new();private bool _started,_disposed;private int _busy;
    public QuotePump(QuoteHub hub,DesktopActivity? activity=null,AlertStore? alerts=null,AppLaunchOptions? options=null,QuoteStreamingService? stream=null)
    {
        _hub=hub;_stream=stream;_alertCadence=options?.NoAlerts!=true;_activity=activity;_alerts=alerts;_timer.Tick+=Tick;
        hub.SubscriptionsChanged+=Schedule;if(activity is not null)activity.Changed+=Schedule;if(alerts is not null)alerts.Changed+=Schedule;
    }
    public TimeSpan CurrentInterval=>_timer.Interval;
    public bool IsPolling=>_timer.IsEnabled;
    public void Start(){if(_disposed)return;_started=true;RefreshSchedule();}
    public void Stop(){_started=false;_timer.Stop();StopStream();}
    private void Schedule(object? sender,EventArgs e)=>Ui.Platform.Run(RefreshSchedule);
    private void RefreshSchedule()
    {
        if(_disposed)return;
        if(!_started||_hub.SubscribedSymbols.Count==0){_timer.Stop();StopStream();return;}
        RefreshStream();
        var interval=_stream is not null&&DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()-Interlocked.Read(ref _lastStreamTick)<5000?TimeSpan.FromMilliseconds(_activity?.AnyVisible==false?1000:250):DesktopActivity.PollInterval(DateTimeOffset.Now,_activity?.AnyVisible??true,_alertCadence&&_alerts?.EnabledSymbols.Count>0);
        if(_timer.Interval!=interval)_timer.Interval=interval;if(!_timer.IsEnabled)_timer.Start();
    }
    private async void Tick(object? sender,EventArgs e)
    {
        if(!_started)return;
        QuoteTick[] ticks;lock(_pendingGate){ticks=_pending.Values.ToArray();_pending.Clear();}
        if(ticks.Length>0)_hub.ApplyTicks(ticks);
        if(_stream is not null)RefreshSchedule();
        if(_stream is not null&&DateTimeOffset.UtcNow<_nextPoll)return;
        if(Interlocked.Exchange(ref _busy,1)==1)return;
        _nextPoll=DateTimeOffset.UtcNow+DesktopActivity.PollInterval(DateTimeOffset.UtcNow,_activity?.AnyVisible??true,_alertCadence&&_alerts?.EnabledSymbols.Count>0);
        try{await _hub.PollAsync(_lifetime.Token);}
        catch(OperationCanceledException)when(_lifetime.IsCancellationRequested){}
        catch(Exception ex){AppLog.Warn("quotes","poll failed: "+ex.Message);}
        finally{Interlocked.Exchange(ref _busy,0);RefreshSchedule();}
    }
    private void StopStream()
    {
        _streamEpoch++;Interlocked.Exchange(ref _lastStreamTick,0);_streamKey="";_streamStop?.Cancel();_streamStop=null;
        lock(_pendingGate)_pending.Clear();
    }
    private void RefreshStream()
    {
        if(_stream is null)return;
        var symbols=_hub.SubscribedSymbols.Order(StringComparer.OrdinalIgnoreCase).Take(50).ToArray();
        var key=string.Join(",",symbols);if(key==_streamKey)return;
        StopStream();_streamKey=key;var epoch=_streamEpoch;var stop=_streamStop=CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
        _streamTask=ReadStream(symbols,epoch,stop,_streamTask);
    }
    private void Interrupted(string[] symbols,long epoch,CancellationTokenSource stop)
    {
        QuoteTick[] pending;lock(_pendingGate){if(epoch!=_streamEpoch||stop.IsCancellationRequested)return;pending=_pending.Values.ToArray();_pending.Clear();}
        Ui.Platform.Run(()=>
        {
            if(epoch!=_streamEpoch||stop.IsCancellationRequested||_disposed)return;
            if(pending.Length>0)_hub.ApplyTicks(pending);
            _hub.MarkStreamInterrupted(symbols);Interlocked.Exchange(ref _lastStreamTick,0);_nextPoll=DateTimeOffset.MinValue;
            RefreshSchedule();Tick(this,EventArgs.Empty); // Same single-flight pump, immediate HTTP recovery attempt.
        });
    }
    private async Task ReadStream(string[] symbols,long epoch,CancellationTokenSource stop,Task previous)
    {
        try
        {
            await previous.ConfigureAwait(false);
            // Debounce page/owner transitions. Old connections are cancelled before the replacement starts.
            await Task.Delay(150,stop.Token).ConfigureAwait(false);
            await foreach(var tick in _stream!.WatchAsync(symbols,_=>Interrupted(symbols,epoch,stop),stop.Token).ConfigureAwait(false))
            {
                var accepted=false;
                lock(_pendingGate)if(epoch==_streamEpoch&&!stop.IsCancellationRequested){_pending[tick.Symbol]=tick;accepted=true;}
                if(accepted){var now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();var prior=Interlocked.Exchange(ref _lastStreamTick,now);if(now-prior>=5000)Ui.Platform.Run(RefreshSchedule);}
            }
        }
        catch(OperationCanceledException)when(stop.IsCancellationRequested){}
        catch(Exception ex){AppLog.Warn("quote-stream","Stream session stopped",ex);}
        finally{Ui.Platform.Run(()=>{if(ReferenceEquals(_streamStop,stop)){_streamStop=null;_streamKey="";}stop.Dispose();});}
    }
    public void Dispose(){if(_disposed)return;Stop();_disposed=true;_lifetime.Cancel();_timer.Tick-=Tick;_hub.SubscriptionsChanged-=Schedule;if(_activity is not null)_activity.Changed-=Schedule;if(_alerts is not null)_alerts.Changed-=Schedule;_lifetime.Dispose();}
}
