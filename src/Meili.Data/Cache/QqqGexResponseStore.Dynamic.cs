using System.Globalization;
using System.Text.Json;
namespace Meili.Data.Cache;
public sealed partial class QqqGexResponseStore
{
    /// <summary>Exact local historical two-leg quote selection. Never substitutes model prices.</summary>
    public Response? ReadSpreadQuote(string pathAndQuery,DateTimeOffset now)
    {
        var canonical=CanonicalKey(pathAndQuery);var index=canonical.IndexOf('|');if(canonical[..index]!="/api/analysis/qqq/gex/spread-quote")return null;
        var q=JsonSerializer.Deserialize<Dictionary<string,string>>(canonical[(index+1)..])!;
        if(q.Keys.Any(k=>k is not ("date" or "expiry" or "at" or "short" or "long"))||!q.TryGetValue("date",out var day)||!DateOnly.TryParseExact(day,"yyyy-MM-dd",out var date)||!q.TryGetValue("expiry",out var expiry)||!DateOnly.TryParseExact(expiry,"yyyy-MM-dd",out var exp)||exp<date||!q.TryGetValue("at",out var at)||!DateTimeOffset.TryParse(at,CultureInfo.InvariantCulture,DateTimeStyles.None,out var cutoff)||cutoff>now||Meili.Core.Time.MarketClock.ToEastern(cutoff).Date!=date.ToDateTime(TimeOnly.MinValue).Date||!q.TryGetValue("short",out var rawShort)||!double.TryParse(rawShort,NumberStyles.Float,CultureInfo.InvariantCulture,out var shortStrike)||!q.TryGetValue("long",out var rawLong)||!double.TryParse(rawLong,NumberStyles.Float,CultureInfo.InvariantCulture,out var longStrike)||!double.IsFinite(shortStrike)||!double.IsFinite(longStrike)||shortStrike<=0||longStrike<=0||shortStrike==longStrike)return null;
        using var c=Open();using var cmd=c.CreateCommand();cmd.CommandText="SELECT d.revision,d.payload,d.updated_at,h.sha256 FROM qqq_gex_local_days d JOIN qqq_gex_local_day_hashes h ON d.day=h.day WHERE d.day=$day";cmd.Parameters.AddWithValue("$day",day);using var r=cmd.ExecuteReader();if(!r.Read())return null;var updated=DateTimeOffset.FromUnixTimeMilliseconds(r.GetInt64(2));if(now>=updated.AddDays(30))return null;
        if(!Hash(r.GetString(1)).Equals(r.GetString(3),StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Local GEX day integrity failed");
        using var doc=JsonDocument.Parse(r.GetString(1));var candidates=doc.RootElement.GetProperty("rows").EnumerateArray().Where(row=>row.GetProperty("expiryDate").GetString()==expiry).Select(row=>(Row:row,Captured:DateTimeOffset.Parse(row.GetProperty("capturedAt").GetString()!,CultureInfo.InvariantCulture))).Where(x=>x.Captured<=cutoff&&x.Captured>=cutoff.AddMinutes(-5)).OrderByDescending(x=>x.Captured).Take(3).Where(x=>x.Row.TryGetProperty("sourceAsOf",out var time)&&DateTimeOffset.TryParse(time.GetString(),out var sourceAt)&&sourceAt<=cutoff&&sourceAt>=cutoff.AddMinutes(-5)).OrderByDescending(x=>DateTimeOffset.Parse(x.Row.GetProperty("sourceAsOf").GetString()!,CultureInfo.InvariantCulture)).ToArray();
        var best=candidates.FirstOrDefault();long? sourceTime=candidates.Length>0?DateTimeOffset.Parse(best.Row.GetProperty("sourceAsOf").GetString()!,CultureInfo.InvariantCulture).ToUnixTimeMilliseconds():null;
        var profile=candidates.Length>0?best.Row.GetProperty("profile").EnumerateArray().Where(p=>p.GetProperty("strike").GetDouble()==shortStrike||p.GetProperty("strike").GetDouble()==longStrike).Select(p=>p.Clone()).ToArray():Array.Empty<JsonElement>();
        var body=JsonSerializer.Serialize(new {date=day,expiry,cutoff=cutoff.ToUnixTimeMilliseconds(),time=sourceTime,profile});return new("application/json",body,r.GetString(0),updated,updated.AddDays(30));
    }
}
