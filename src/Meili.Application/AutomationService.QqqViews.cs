using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Meili.Data.Cache;

namespace Meili.Automation;
public sealed partial class AutomationService
{
    private async Task<object> ReadQqqViewAsync(Input a,CancellationToken ct)
    {
        var resource=a.Text("resource");var query=new List<KeyValuePair<string,string>>();
        void Add(string key,string value)=>query.Add(new(key,value));
        string Date(string key)=>a.Date(key)?.ToString("yyyy-MM-dd")??throw new ArgumentException(key+" is required");
        string Instant(string key){if(a.Instant(key) is null)throw new ArgumentException(key+" is required");return a.Text(key);}
        var allowed=new HashSet<string>{"resource","offset","length","sha256"};string route;
        void Permit(params string[] fields){foreach(var field in fields)allowed.Add(field);}
        switch(resource)
        {
            case "display":case "evidence":
                route="/api/analysis/qqq/pcs";Permit("expiry","from","to","regimeMode");Add("gexDisplay","1");Add("gexOverview","1");
                if(a.Has("expiry"))Add("gexExpiry",Date("expiry"));
                if(a.Has("from")||a.Has("to")){var from=a.Instant("from")??throw new ArgumentException("from is required");var to=a.Instant("to")??throw new ArgumentException("to is required");if(to<=from||to-from>TimeSpan.FromMinutes(90))throw new ArgumentException("Display window must increase and be at most 90 minutes");Add("from",Instant("from"));Add("to",Instant("to"));}
                else Add("gexWindow","latest");
                if(resource=="evidence")Add("gexEvidence","1");
                if(a.Has("regimeMode"))Add("regimeMode",a.Text("regimeMode"));break;
            case "analysis":
                route="/api/analysis/qqq/local-analysis";Permit("date","expiry","at","analysis","scope","mode","metric","side","shortStrike","longStrike","ivShockPp","fees","basis","manualCredit","minutes","strikes");Add("date",Date("date"));Add("at",Instant("at"));if(!a.Has("analysis"))throw new ArgumentException("analysis is required");Add("analysis",a.Text("analysis"));if(a.Has("strikes")){var strikes=a.Value.GetProperty("strikes").EnumerateArray().Select(v=>v.GetDouble()).ToArray();if(strikes.Length>2000||strikes.Any(v=>!double.IsFinite(v)||v<=0))throw new ArgumentException("Invalid selected strikes");Add("strikes",string.Join(",",strikes.Select(v=>v.ToString(System.Globalization.CultureInfo.InvariantCulture))));}foreach(var key in new[]{"expiry","scope","mode","metric","side","shortStrike","longStrike","ivShockPp","fees","basis","manualCredit","minutes"})if(a.Has(key))Add(key,key=="expiry"?Date(key):key is "shortStrike" or "longStrike" or "ivShockPp" or "fees" or "manualCredit" or "minutes"?a.Number(key).ToString(System.Globalization.CultureInfo.InvariantCulture):a.Text(key));break;
            case "context":
                route="/api/analysis/qqq/gex/intraday-context";Permit("date","dte","include","at");Add("asOf",Instant("at"));Add("date",Date("date"));Add("dte",a.Int("dte",0,0,60).ToString());Add("include",a.Text("include","all"));break;
            case "exposureManifest":case "exposureWindow":
                route="/api/analysis/qqq/gex/exposure";Permit("date","expiry");Add("date",Date("date"));if(a.Has("expiry"))Add("expiryDate",Date("expiry"));Add("format",resource=="exposureManifest"?"manifest-v2":"lines-v2");
                if(resource=="exposureWindow"){Permit("from","to","source");var from=a.Instant("from")??throw new ArgumentException("from is required");var to=a.Instant("to")??throw new ArgumentException("to is required");if(to<=from||to-from>TimeSpan.FromHours(1))throw new ArgumentException("Exposure windows are at most one hour");Add("from",Instant("from"));Add("to",Instant("to"));if(!a.Has("source"))throw new ArgumentException("source window version from manifest is required");Add("source",a.Text("source"));Add("profiles","true");}break;
            case "spreadQuote":
                route="/api/analysis/qqq/gex/spread-quote";Permit("date","expiry","at","shortStrike","longStrike");Add("date",Date("date"));Add("expiry",Date("expiry"));Add("at",Instant("at"));var shortStrike=a.Positive("shortStrike");var longStrike=a.Positive("longStrike");if(shortStrike==longStrike)throw new ArgumentException("Spread strikes must differ");Add("short",shortStrike.ToString(System.Globalization.CultureInfo.InvariantCulture));Add("long",longStrike.ToString(System.Globalization.CultureInfo.InvariantCulture));break;
            default:throw new ArgumentException("Unknown GEX view resource");
        }
        if(a.Value.EnumerateObject().Any(p=>!allowed.Contains(p.Name)))throw new ArgumentException("Parameter is not applicable to this resource");
        var offset=a.Int("offset",0,0,128*1024*1024);var length=a.Int("length",65536,1,262144);if(offset>0&&!a.Has("sha256"))throw new ArgumentException("Continuation requires first chunk sha256");
        var db=Path.Combine(DirectoryInfo.Path,"cache","qqq-gex.db");if(!File.Exists(db))return new{status="cache_miss",available=false,complete=false};
        var path=route+"?"+string.Join("&",query.Select(p=>Uri.EscapeDataString(p.Key)+"="+Uri.EscapeDataString(p.Value)));string body,contentType;
        if(resource=="spreadQuote"){
            var response=new QqqGexResponseStore(db).ReadSpreadQuote(path,DateTimeOffset.UtcNow);if(response is null)return new{status="cache_miss",available=false,complete=false};body=response.Body;contentType=response.ContentType;
        }else{
            var result=await QqqGexCalculationRunner.QueryAsync(DirectoryInfo.Path,path,ct);var json=JsonSerializer.SerializeToElement(result);
            if(json.TryGetProperty("status",out _))return json;
            if(json.TryGetProperty("body",out var wire)){body=wire.GetString()!;contentType=json.GetProperty("contentType").GetString()!;}
            else{body=json.GetRawText();contentType="application/json";}
        }
        var bytes=Encoding.UTF8.GetBytes(body);var sha=Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        if(a.Has("sha256")&&!string.Equals(a.Text("sha256"),sha,StringComparison.OrdinalIgnoreCase))return new{status="revision_changed",available=false,complete=false,sha256=sha,restartOffset=0};
        if(offset>bytes.Length)throw new ArgumentException("Offset exceeds response length");var count=Math.Min(length,bytes.Length-offset);var next=offset+count;
        return new{available=true,complete=false,resource,contentType,sha256=sha,totalBytes=bytes.Length,offset,chunkBytes=count,encoding="base64",bodyBase64=Convert.ToBase64String(bytes,offset,count),hasMore=next<bytes.Length,nextOffset=next<bytes.Length?(int?)next:null,coverage="Exact local UI response bytes; concatenate decoded chunks and verify SHA256. This certifies transport consistency only, not historical or input completeness. No remote fallback. Re-read exposure manifest after all windows."};
    }
}
