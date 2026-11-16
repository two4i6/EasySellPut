using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Meili.Core.Abstractions;
using Meili.Core.Models;
using Meili.Core.Settings;
using Meili.Data.Http;
namespace Meili.Data.Providers.Yahoo;

/// <summary>One cancellable socket per consumer, through the same configured proxy as HTTP. Reconnection belongs to the shared application session.</summary>
public sealed class YahooQuoteStream : IQuoteStreamSource
{
    public string SourceId=>"yahoo";
    public string Coverage=>"Yahoo public indicative last-price stream; latency and consolidated/NBBO coverage are not guaranteed. No tick is not proof of disconnection or zero price.";
    private readonly Func<CancellationToken,Task<WebSocket>> _connect;
    public YahooQuoteStream(HttpGateway gateway):this(ct=>Connect(gateway,ct)){}
    internal YahooQuoteStream(Func<CancellationToken,Task<WebSocket>> connect)=>_connect=connect;
    private static async Task<WebSocket> Connect(HttpGateway gateway,CancellationToken ct)
    {
        var socket=new ClientWebSocket();socket.Options.KeepAliveInterval=TimeSpan.FromSeconds(15);socket.Options.KeepAliveTimeout=TimeSpan.FromSeconds(10);
        socket.Options.SetRequestHeader("User-Agent",HttpGateway.BrowserUserAgent);
        try{await gateway.ConnectWebSocketAsync(socket,new Uri("wss://streamer.finance.yahoo.com/?version=2"),ct).ConfigureAwait(false);return socket;}
        catch{socket.Dispose();throw;}
    }
    public async IAsyncEnumerable<QuoteTick> WatchAsync(IReadOnlyList<string> symbols,[EnumeratorCancellation] CancellationToken ct=default)
    {
        var normalized=symbols.Select(s=>WatchlistStore.TryNormalizeSymbol(s,out var symbol,out _)?symbol:throw new ArgumentException("Invalid ticker.")).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if(normalized.Length is <1 or >50)throw new ArgumentException("Streaming supports 1..50 symbols.");
        var map=normalized.GroupBy(YahooProvider.ToYahoo,StringComparer.OrdinalIgnoreCase).ToDictionary(g=>g.Key,g=>g.ToArray(),StringComparer.OrdinalIgnoreCase);
        WebSocket connected;
        using(var connect=CancellationTokenSource.CreateLinkedTokenSource(ct)){connect.CancelAfter(TimeSpan.FromSeconds(12));connected=await _connect(connect.Token).ConfigureAwait(false);}
        using var socket=connected;
        var subscription=Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{subscribe=map.Keys}));
        await socket.SendAsync(subscription,WebSocketMessageType.Text,true,ct).ConfigureAwait(false);
        using var lifetime=CancellationTokenSource.CreateLinkedTokenSource(ct);
        var heartbeat=KeepSubscribed(socket,subscription,lifetime.Token);
        var buffer=new byte[65536];
        try
        {
            while(true)
            {
                var length=0;ValueWebSocketReceiveResult frame;
                do
                {
                    if(length==buffer.Length)throw new FormatException("Oversized streaming message.");
                    frame=await socket.ReceiveAsync(buffer.AsMemory(length),ct).ConfigureAwait(false);
                    if(frame.MessageType==WebSocketMessageType.Close)throw new WebSocketException("Quote socket closed by source.");
                    if(frame.MessageType!=WebSocketMessageType.Text)throw new FormatException("Unsupported streaming frame.");
                    length+=frame.Count;
                }while(!frame.EndOfMessage);
                var tick=YahooStreamDecoder.Parse(Encoding.UTF8.GetString(buffer,0,length));
                if(tick is not null&&map.TryGetValue(tick.Symbol,out var originals))foreach(var symbol in originals)yield return tick with{Symbol=symbol};
            }
        }
        finally{lifetime.Cancel();socket.Abort();try{await heartbeat.ConfigureAwait(false);}catch(OperationCanceledException){}catch(WebSocketException){}}
    }
    private static async Task KeepSubscribed(WebSocket socket,byte[] message,CancellationToken ct)
    {
        try{while(true){await Task.Delay(TimeSpan.FromSeconds(15),ct).ConfigureAwait(false);await socket.SendAsync(message,WebSocketMessageType.Text,true,ct).ConfigureAwait(false);}}
        catch(Exception)when(!ct.IsCancellationRequested){socket.Abort();throw;}
    }
}
