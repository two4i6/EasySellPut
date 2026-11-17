using System.Text.Json;
using Meili.Core.Abstractions;
using Meili.Core.Settings;
using Meili.Data;

internal static class SourceAudit
{
    internal static async Task<int> RunAsync()
    {
        if(Environment.GetEnvironmentVariable("MEILI_LIVE")!="1")throw new InvalidOperationException("Source audit requires MEILI_LIVE=1");
        using var services=new DataServices(new NetworkSettings());
        foreach(var provider in services.Providers.Where(p=>p is IOptionsProvider))
        {
            using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(60));var began=DateTimeOffset.UtcNow;
            try
            {
                var options=(IOptionsProvider)provider;
                var expiries=await options.GetExpirationsAsync("QQQ",deadline.Token);
                var chain=await options.GetChainAsync("QQQ",expiries.Order().First(),deadline.Token);
                object? raw=null;
                if(!chain.RawSourcePayload.IsEmpty)
                {
                    using var doc=JsonDocument.Parse(chain.RawSourcePayload);
                    var root=doc.RootElement;var data=root.GetProperty("data");
                    raw=new{publication=root.GetProperty("timestamp").GetString(),underlyingLastTrade=data.TryGetProperty("last_trade_time",out var trade)?trade.ToString():null,sha256=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(chain.RawSourcePayload.Span))};
                }
                Console.WriteLine(JsonSerializer.Serialize(new{provider=provider.Id,began,completed=DateTimeOffset.UtcNow,status="observed",expiries=expiries.Count,expiry=chain.Expiration,chain.AsOf,chain.UnderlyingLastTradeAt,chain.FetchedAt,chain.DelayMinutes,chain.IsRealtime,contracts=chain.Contracts.Count,missingIvWithOi=chain.Contracts.Count(c=>c.OpenInterest is >0&&c.ImpliedVolatility is not >0),missingOi=chain.Contracts.Count(c=>c.OpenInterest is null),raw,coverage="one earliest expiry; independent source observation, no cross-provider filling or complete-history claim"}));
            }
            catch(Exception e){Console.WriteLine(JsonSerializer.Serialize(new{provider=provider.Id,began,completed=DateTimeOffset.UtcNow,status="unavailable",error=e.GetType().Name,coverage="No source data certified"}));}
        }
        return 0;
    }
}
