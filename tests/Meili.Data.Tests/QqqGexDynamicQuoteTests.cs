using Meili.Data.Cache;
using Microsoft.Data.Sqlite;
using System.Text.Json;
namespace Meili.Data.Tests;
public sealed class QqqGexDynamicQuoteTests
{
    [Fact] public void Quotes_use_published_source_time_and_exact_legs_without_model_substitution()
    {
        var path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".db");var store=new QqqGexResponseStore(path);var now=DateTimeOffset.UtcNow;
        using(var c=new SqliteConnection("Data Source="+path)){c.Open();using var cmd=c.CreateCommand();cmd.CommandText="INSERT INTO qqq_gex_local_days VALUES('2026-01-02','r1',$body,$updated)";cmd.Parameters.AddWithValue("$body",JsonSerializer.Serialize(new {rows=new[]{new {capturedAt="2026-01-02T14:32:00Z",sourceAsOf="2026-01-02T14:34:00Z",expiryDate="2026-01-05",profile=new[]{new {strike=600,callBid=0,callAsk=1},new {strike=601,callBid=2,callAsk=3},new {strike=602,callBid=4,callAsk=5}}}}}));cmd.Parameters.AddWithValue("$updated",now.ToUnixTimeMilliseconds());cmd.ExecuteNonQuery();var body=cmd.Parameters["$body"].Value!.ToString()!;cmd.CommandText="INSERT INTO qqq_gex_local_day_hashes VALUES('2026-01-02',$hash)";cmd.Parameters.Clear();cmd.Parameters.AddWithValue("$hash",Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(body))));cmd.ExecuteNonQuery();}
        var prefix="/api/analysis/qqq/gex/spread-quote?date=2026-01-02&expiry=2026-01-05&short=600&long=601&at=";
        using var early=JsonDocument.Parse(store.ReadSpreadQuote(prefix+"2026-01-02T14:33:00Z",now)!.Body);Assert.Equal(JsonValueKind.Null,early.RootElement.GetProperty("time").ValueKind);Assert.Empty(early.RootElement.GetProperty("profile").EnumerateArray());
        using var quote=JsonDocument.Parse(store.ReadSpreadQuote(prefix+"2026-01-02T14:35:00Z",now)!.Body);Assert.Equal(2,quote.RootElement.GetProperty("profile").GetArrayLength());Assert.NotNull(store.ReadSpreadQuote(prefix+"2026-01-02T14:35:00Z",now.AddYears(20)));Assert.Equal(0,quote.RootElement.GetProperty("profile")[0].GetProperty("callBid").GetInt32());
        Assert.Null(store.ReadSpreadQuote(prefix+"2026-01-03T14:35:00Z",now));
    }
}
