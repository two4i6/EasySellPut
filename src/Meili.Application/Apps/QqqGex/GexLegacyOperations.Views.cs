using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Meili.Data.Cache;

namespace Meili.Automation.Apps.QqqGex;
internal sealed partial class GexLegacyOperations
{
    private async Task<object> ReadQqqViewAsync(Input a,CancellationToken ct)
    {
        var resource=a.Text("resource");var query=new List<KeyValuePair<string,string>>();
        void Add(string key,string value)=>query.Add(new(key,value));
        string Date(string key)=>a.Date(key)?.ToString("yyyy-MM-dd")??throw new ArgumentException(key+" is required");
        string Instant(string key){if(a.Instant(key) is null)throw new ArgumentException(key+" is required");return a.Text(key);}
        if(resource=="workspace"){
            if(a.Value.EnumerateObject().Any(p=>p.Name is not ("resource" or "offset" or "length" or "sha256")))throw new ArgumentException("Workspace accepts only chunk parameters");
            return ChunkQqqView(a,resource,JsonSerializer.Serialize(new Meili.Shared.Services.QqqGexWorkspace(directory).Read()),"application/json");
        }
        if(resource=="partial"){
            if(a.Value.EnumerateObject().Any(p=>p.Name is not ("resource" or "offset" or "length" or "sha256")))throw new ArgumentException("Partial view accepts only chunk parameters");
            var partialDb=Path.Combine(directory,"cache","qqq-gex.db");if(!File.Exists(partialDb))return new{available=false,status="cache_miss",complete=false};
            var partial=QqqGexResponseStore.ReadLatestPartialReadOnly(partialDb);
            return ChunkQqqView(a,resource,JsonSerializer.Serialize(new{available=partial is not null,complete=false,partial}),"application/json");
        }
        if(resource=="providerRaw"){
            if(a.Value.EnumerateObject().Any(p=>p.Name is not ("resource" or "providerHash" or "offset" or "length" or "sha256")))throw new ArgumentException("Provider raw accepts only an indexed hash and chunk parameters");
            var hash=a.Text("providerHash");if(!System.Text.RegularExpressions.Regex.IsMatch(hash,"^[0-9a-fA-F]{64}$"))throw new ArgumentException("providerHash must be a hash from archive resource=providers");
            var sourceDb=Path.Combine(directory,"cache","qqq-gex.db");if(!File.Exists(sourceDb))return new{available=false,status="cache_miss",complete=false};
            return ChunkQqqBytes(a,resource,QqqGexResponseStore.ReadProviderBodyReadOnly(sourceDb,hash.ToUpperInvariant()),"application/octet-stream");
        }
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
                route="/api/analysis/qqq/local-analysis";Permit("date","expiry","at","analysis","scope","mode","metric","side","shortStrike","longStrike","ivShockPp","fees","basis","manualCredit","minutes","strikes","overlays","reactions","viewportFrom","viewportTo","plotWidth","policy","preset","hiddenLegends","discovery","wallHorizon","wallGamma","wallPeriod","wallSide");Add("date",Date("date"));Add("at",Instant("at"));if(!a.Has("analysis"))throw new ArgumentException("analysis is required");Add("analysis",a.Text("analysis"));if(Meili.Core.Time.MarketClock.ToEastern(a.Instant("at")!.Value).ToString("yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture)!=Date("date"))throw new ArgumentException("Analysis cursor must belong to requested Eastern date");foreach(var (name,study,choices) in new[]{("hiddenLegends","chartStudies",new[]{"kc","directional_markers","price","live","vwap","rsi","score","confirmation","gex_table","gex_positive","gex_negative","wall_history","markers","session_shade","king","call_wall","put_wall","gamma_flip","gamma_position","net_gex","trade_low","trade_high"}),("discovery","structureEvents",new[]{"changes","tracks","events","skew","bands"})}){if(a.Has(name)){var values=a.Value.GetProperty(name).EnumerateArray().Select(v=>v.GetString()??"").ToArray();if(a.Text("analysis")!=study||values.Length>choices.Length||values.Distinct().Count()!=values.Length||values.Any(v=>!choices.Contains(v)))throw new ArgumentException("Invalid "+name+" selection");Add(name,string.Join(",",values));}}if(a.Has("preset")){if(a.Text("analysis")!="chartStudies"||a.Text("preset") is not ("simple" or "structure" or "all"))throw new ArgumentException("Invalid chart preset");Add("preset",a.Text("preset"));}if(a.Has("policy")){if(a.Text("analysis")!="dayScenario"||a.Text("policy") is not ("partial" or "complete"))throw new ArgumentException("Invalid scenario policy");Add("policy",a.Text("policy"));}if(a.Has("viewportFrom")||a.Has("viewportTo")||a.Has("plotWidth")){var first=a.Instant("viewportFrom")??throw new ArgumentException("viewportFrom is required");var last=a.Instant("viewportTo")??throw new ArgumentException("viewportTo is required");var width=a.Number("plotWidth");if(a.Text("analysis")!="priceReactions"||last<=first||last-first>TimeSpan.FromHours(25)||!double.IsFinite(width)||width<1||width>10000)throw new ArgumentException("Invalid price reaction viewport");Add("viewportFrom",Instant("viewportFrom"));Add("viewportTo",Instant("viewportTo"));Add("plotWidth",width.ToString(System.Globalization.CultureInfo.InvariantCulture));}if(a.Has("reactions")){if(a.Text("analysis")!="priceReactions")throw new ArgumentException("Reaction selection requires priceReactions analysis");var reactions=a.Value.GetProperty("reactions").EnumerateArray().Select(v=>v.GetString()??"").ToArray();if(reactions.Length>3||reactions.Distinct().Count()!=reactions.Length||reactions.Any(v=>v is not ("markers" or "low" or "high")))throw new ArgumentException("Invalid price reaction selection");Add("reactions",string.Join(",",reactions));}if(a.Has("overlays")){if(a.Text("analysis")!="overlays")throw new ArgumentException("Overlay selection requires overlays analysis");var overlays=a.Value.GetProperty("overlays").EnumerateArray().Select(v=>v.GetString()??"").ToArray();if(overlays.Length>4||overlays.Distinct().Count()!=overlays.Length||overlays.Any(v=>v is not ("vwap" or "delta" or "iv" or "putCall")))throw new ArgumentException("Invalid overlay selection");Add("overlays",string.Join(",",overlays));}foreach(var name in new[]{"wallHorizon","wallGamma","wallPeriod","wallSide"})if(a.Has(name)){
                    if(a.Text("analysis")!="wallTouches")throw new ArgumentException("Wall filters require wallTouches");
                    var value=name=="wallHorizon"?a.Int(name,30,10,30).ToString():a.Text(name);
                    var choices=name switch{"wallHorizon"=>new[]{"10","30"},"wallGamma"=>new[]{"all","positive","negative","zero"},"wallPeriod"=>new[]{"all","open","middle","late"},_=>new[]{"all","put","call"}};
                    if(!choices.Contains(value))throw new ArgumentException("Invalid wall-touch filter");Add(name,value);
                }
                if(a.Has("minutes")&&(a.Text("analysis") is not ("activityResponse" or "structureEvents")||a.Int("minutes",10,2,30) is not (2 or 10 or 30)))throw new ArgumentException("Unsupported observation window");if(a.Has("strikes")){if(a.Text("analysis") is not ("exposure" or "heatmapField"))throw new ArgumentException("Strike selection requires exposure or heatmapField");var strikes=a.Value.GetProperty("strikes").EnumerateArray().Select(v=>v.GetDouble()).ToArray();if(strikes.Length>2000||strikes.Any(v=>!double.IsFinite(v)||v<=0))throw new ArgumentException("Invalid selected strikes");Add("strikes",string.Join(",",strikes.Select(v=>v.ToString(System.Globalization.CultureInfo.InvariantCulture))));}foreach(var key in new[]{"expiry","scope","mode","metric","side","shortStrike","longStrike","ivShockPp","fees","basis","manualCredit","minutes"})if(a.Has(key))Add(key,key=="expiry"?Date(key):key is "shortStrike" or "longStrike" or "ivShockPp" or "fees" or "manualCredit" or "minutes"?a.Number(key).ToString(System.Globalization.CultureInfo.InvariantCulture):a.Text(key));break;
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
        var db=Path.Combine(directory,"cache","qqq-gex.db");if(!File.Exists(db))return new{status="cache_miss",available=false,complete=false};
        var path=route+"?"+string.Join("&",query.Select(p=>Uri.EscapeDataString(p.Key)+"="+Uri.EscapeDataString(p.Value)));string body,contentType;
        if(resource=="spreadQuote"){
            var response=new QqqGexResponseStore(db).ReadSpreadQuote(path,DateTimeOffset.UtcNow);if(response is null)return new{status="cache_miss",available=false,complete=false};body=response.Body;contentType=response.ContentType;
        }else{
            var result=await QueryAsync(path,ct);var json=JsonSerializer.SerializeToElement(result);
            if(json.TryGetProperty("status",out _))return json;
            if(json.TryGetProperty("body",out var wire)){body=wire.GetString()!;contentType=json.GetProperty("contentType").GetString()!;}
            else{body=json.GetRawText();contentType="application/json";}
        }
        return ChunkQqqView(a,resource,body,contentType);
    }
    private static object ChunkQqqView(Input a,string resource,string body,string contentType)
    {
        return ChunkQqqBytes(a,resource,Encoding.UTF8.GetBytes(body),contentType);
    }
    private static object ChunkQqqBytes(Input a,string resource,byte[] bytes,string contentType)
    {
        var offset=a.Int("offset",0,0,128*1024*1024);var length=a.Int("length",65536,1,262144);if(offset>0&&!a.Has("sha256"))throw new ArgumentException("Continuation requires first chunk sha256");
        var sha=Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        if(a.Has("sha256")&&!string.Equals(a.Text("sha256"),sha,StringComparison.OrdinalIgnoreCase))return new{status="revision_changed",available=false,complete=false,sha256=sha,restartOffset=0};
        if(offset>bytes.Length)throw new ArgumentException("Offset exceeds response length");var count=Math.Min(length,bytes.Length-offset);var next=offset+count;
        return new{available=true,complete=false,resource,contentType,sha256=sha,totalBytes=bytes.Length,offset,chunkBytes=count,encoding="base64",bodyBase64=Convert.ToBase64String(bytes,offset,count),hasMore=next<bytes.Length,nextOffset=next<bytes.Length?(int?)next:null,coverage=(resource switch{"workspace"=>"Allowlisted saved UI preferences and timestamped last desktop observation; not guaranteed current screen or live quote.","partial"=>"Same native partial-capture projection; not a published complete day.","providerRaw"=>"Original hash-verified retained provider bytes, not a model reconstruction or arbitrary file.",_=>"Exact retained UI-kernel response bytes; not full historical/input completeness."})+" Concatenate decoded chunks and verify SHA256; changes restart. No remote fallback. Re-read exposure manifest after all windows."};
    }
}
