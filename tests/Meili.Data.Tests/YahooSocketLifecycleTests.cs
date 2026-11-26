using System.Net.WebSockets;
using System.Text;
using Meili.Data.Providers.Yahoo;
namespace Meili.Data.Tests;

public sealed class YahooSocketLifecycleTests
{
    private sealed class Socket : WebSocket
    {
        public List<string> Sent=[];public bool Disposed;
        private readonly byte[] _frame=Encoding.UTF8.GetBytes("{\"type\":\"pricing\",\"message\":\"CgNRUVEV4zonRBjQiaTRvGgqA05HTTAUOAFFnIbOv0jGh+oMZcCEL8GwAZAD2AEE9QLAhC/B/QKchs6/\"}");
        private int _position;public override WebSocketCloseStatus? CloseStatus=>null;public override string? CloseStatusDescription=>null;public override WebSocketState State=>WebSocketState.Open;public override string? SubProtocol=>null;
        public override void Abort(){}public override void Dispose()=>Disposed=true;
        public override Task CloseAsync(WebSocketCloseStatus s,string? d,CancellationToken ct)=>Task.CompletedTask;
        public override Task CloseOutputAsync(WebSocketCloseStatus s,string? d,CancellationToken ct)=>Task.CompletedTask;
        public override Task SendAsync(ArraySegment<byte> b,WebSocketMessageType t,bool end,CancellationToken ct){Sent.Add(Encoding.UTF8.GetString(b));return Task.CompletedTask;}
        public override async Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> b,CancellationToken ct)
        {
            if(_position==_frame.Length)await Task.Delay(Timeout.Infinite,ct);
            var n=Math.Min(7,_frame.Length-_position);_frame.AsSpan(_position,n).CopyTo(b.AsSpan());_position+=n;
            return new(n,WebSocketMessageType.Text,_position==_frame.Length);
        }
    }
    [Fact]public async Task Source_subscribes_once_reassembles_fragments_filters_symbols_and_disposes_idle_socket_on_cancel()
    {
        var socket=new Socket();var source=new YahooQuoteStream(_=>Task.FromResult<WebSocket>(socket));
        using var stop=new CancellationTokenSource();await using(var reader=source.WatchAsync(["QQQ"],stop.Token).GetAsyncEnumerator())
        {
            Assert.True(await reader.MoveNextAsync());Assert.Equal("QQQ",reader.Current.Symbol);Assert.Single(socket.Sent);Assert.Contains("subscribe",socket.Sent[0]);
            var pending=reader.MoveNextAsync().AsTask();stop.Cancel();await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>pending);
        }
        Assert.True(socket.Disposed);
    }
}
