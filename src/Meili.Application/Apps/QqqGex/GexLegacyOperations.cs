using System.Text.Json;
using Meili.Core.Abstractions;
using Meili.Data.Cache;
using Meili.Shared.Services;
namespace Meili.Automation.Apps.QqqGex;

/// <summary>Explicit compatibility adapter until every public facade is supplied by a signed app operation.</summary>
internal sealed partial class GexLegacyOperations(string directory,Func<CancellationToken,Task<IMarketDataService>> market)
{
    internal async Task<object> ExecuteAsync(string operation,Input a,CancellationToken ct)
    {
        switch(operation)
        {
            case "rebuild_qqq_gex_history":
                if(!File.Exists(Path.Combine(directory,"cache","qqq-gex.db"))||!new QqqGexResponseStore(Path.Combine(directory,"cache","qqq-gex.db")).HasLocalHistory())return new {status="no_observed_inputs",complete=false,processed=0};
                return await QqqGexCalculationRunner.RebuildHistoryAsync(directory,a.Int("limit",100,1,400),a.Bool("retryFailed"),ct);
            case "get_qqq_gex_view": return await ReadQqqViewAsync(a,ct);
            case "get_qqq_gex_archive":
                {
                    var resource=a.Text("resource");var page=a.Int("page",1,1,100000);var pageSize=a.Int("pageSize",100,1,200);
                    if(resource is not ("dates" or "providers")&&!a.Has("date"))throw new ArgumentException("Trading date is required");
                    if(resource=="profile"&&(!a.Has("expiry")||!a.Has("capturedAt")))throw new ArgumentException("Profile requires expiry and capturedAt from snapshots");
                    if(page>1&&!a.Has("revision"))throw new ArgumentException("Continuation requires revision");
                    var query="/api/analysis/qqq/local-archive?resource="+Uri.EscapeDataString(resource)+"&page="+page+"&pageSize="+pageSize;
                    if(a.Has("archiveState")){var state=a.Text("archiveState");if(state is not ("published" or "partial")||resource=="providers")throw new ArgumentException("Invalid archive state");query+="&archiveState="+state;}
                    foreach(var key in new[]{"date","expiry"})if(a.Has(key))query+="&"+key+"="+a.Date(key)!.Value.ToString("yyyy-MM-dd");
                    foreach(var key in new[]{"capturedAt","revision"})if(a.Has(key))query+="&"+key+"="+Uri.EscapeDataString(a.Text(key));
                    if(!File.Exists(Path.Combine(directory,"cache","qqq-gex.db")))return new {status="cache_miss",available=false,complete=false};
                    return await QqqGexCalculationRunner.QueryAsync(directory,query,ct);
                }
            case "get_qqq_gex_lifecycle":
                {var date=a.Date("date")!.Value.ToString("yyyy-MM-dd");if(!File.Exists(Path.Combine(directory,"cache","qqq-gex.db")))return new {available=true,storageAvailable=false,date,recorded=false,complete=false,points=Array.Empty<object>(),coverage="Only explicitly captured local PCS observations; missing historical blobs are not reconstructed"};var response=new QqqGexResponseStore(Path.Combine(directory,"cache","qqq-gex.db")).ReadLifecycle("/api/analysis/qqq/pcs/lifecycle?date="+date)!;using var document=JsonDocument.Parse(response.Body);return document.RootElement.Clone();}
            case "get_qqq_gex_live_decision":
                if(!File.Exists(Path.Combine(directory,"cache","qqq-gex.db"))||!new QqqGexResponseStore(Path.Combine(directory,"cache","qqq-gex.db")).HasObservedInput())return new {status="cache_miss",available=false,complete=false};
                return await QqqGexCalculationRunner.QueryAsync(directory,"/api/analysis/qqq/pcs/local-decision?regimeMode="+a.Text("regimeMode","unified"),ct);
            case "get_qqq_gex_replay":
                {
                    var from=a.Instant("from")!.Value.ToUniversalTime();var to=a.Instant("to")!.Value.ToUniversalTime();
                    if(to<=from||to-from>TimeSpan.FromDays(366))throw new ArgumentException("Replay range must increase and be at most 366 days");
                    if(!File.Exists(Path.Combine(directory,"cache","qqq-gex.db"))||!new QqqGexResponseStore(Path.Combine(directory,"cache","qqq-gex.db")).HasLocalHistory())return new {status="cache_miss",available=false,complete=false};
                    var query="/api/analysis/qqq/pcs/backtest?stream=signals&from="+Uri.EscapeDataString(from.ToString("O"))+"&to="+Uri.EscapeDataString(to.ToString("O"))+"&page="+a.Int("page",1,1,100000)+"&pageSize="+a.Int("pageSize",200,1,200);
                    return await QqqGexCalculationRunner.QueryAsync(directory,query,ct);
                }
            case "calculate_qqq_gex_local": return await QqqGexCalculationRunner.RunAsync(directory,ct);
            case "capture_qqq_gex_input": return await new QqqGexCaptureService(await market(ct),directory).CaptureAsync(ct);
            default:throw new ArgumentException("Unknown GEX compatibility operation.");
        }
    }
}
