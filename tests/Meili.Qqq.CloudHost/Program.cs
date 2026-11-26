using System.Text.Json;
using Meili.Shared.Services;
using Meili.Automation;
// Cloud test harness only; never included in application distributions.
if(args is ["--source-audit"])return await SourceAudit.RunAsync();
if(args is ["--serve",var database]){using var memorySampler=new System.Threading.Timer(_=>{var info=GC.GetGCMemoryInfo();Console.Error.WriteLine(JsonSerializer.Serialize(new{qqqTestMemory=true,managedBytes=GC.GetTotalMemory(false),heapBytes=info.HeapSizeBytes,committedBytes=info.TotalCommittedBytes,fragmentedBytes=info.FragmentedBytes,allocatedBytes=GC.GetTotalAllocatedBytes(false),gen2Collections=GC.CollectionCount(2)}));},null,250,250);await using var session=new QqqGexSession(Path.GetFullPath(database));Console.WriteLine(JsonSerializer.Serialize(new{pageUri=session.PageUri.AbsoluteUri}));await Console.In.ReadLineAsync();return 0;}
if(args is ["--measure-day",var dayDatabase,var dayPath]){
    var store=new Meili.Data.Cache.QqqGexResponseStore(dayDatabase);var runs=new List<object>();
    for(var n=0;n<5;n++){var allocated=GC.GetAllocatedBytesForCurrentThread();var clock=System.Diagnostics.Stopwatch.StartNew();var response=store.ReadLocalDay(dayPath,DateTimeOffset.UtcNow)??throw new InvalidOperationException("Day missing");runs.Add(new{elapsedMs=clock.Elapsed.TotalMilliseconds,allocatedBytes=GC.GetAllocatedBytesForCurrentThread()-allocated,responseBytes=System.Text.Encoding.UTF8.GetByteCount(response.Body),sha256=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(response.Body))),workingSetBytes=System.Diagnostics.Process.GetCurrentProcess().WorkingSet64,managedBytes=GC.GetTotalMemory(false),gcCommittedBytes=GC.GetGCMemoryInfo().TotalCommittedBytes});}
    Console.WriteLine(JsonSerializer.Serialize(new{runs,peakWorkingSetBytes=System.Diagnostics.Process.GetCurrentProcess().PeakWorkingSet64}));return 0;
}
if(args is ["--measure-query-wire",var wireDirectory,var wirePath]){
    var result=(JsonElement)await QqqGexCalculationRunner.QueryAsync(wireDirectory,wirePath);var options=new JsonSerializerOptions{Encoder=System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping};
    byte[] Encode(bool direct)=>direct?JsonSerializer.SerializeToUtf8Bytes(result,options):System.Text.Encoding.UTF8.GetBytes(result.GetRawText());
    var original=Encode(false);if(!original.AsSpan().SequenceEqual(Encode(true)))throw new InvalidOperationException("Query HTTP wire bytes changed");
    var runs=new List<object>();foreach(var direct in new[]{false,true}){Encode(direct);var allocated=GC.GetAllocatedBytesForCurrentThread();var clock=System.Diagnostics.Stopwatch.StartNew();for(var n=0;n<10;n++)Encode(direct);runs.Add(new{direct,iterations=10,elapsedMs=clock.Elapsed.TotalMilliseconds,allocatedBytes=GC.GetAllocatedBytesForCurrentThread()-allocated});}
    Console.WriteLine(JsonSerializer.Serialize(new{responseBytes=original.Length,exactBytesEqual=true,runs}));return 0;
}
if(args is ["--measure-query",var queryDirectory,var queryPath]){
    var allocated=GC.GetTotalAllocatedBytes(true);var clock=System.Diagnostics.Stopwatch.StartNew();
    var result=await QqqGexCalculationRunner.QueryAsync(queryDirectory,queryPath);
    var bytesAllocated=GC.GetTotalAllocatedBytes(true)-allocated;var elapsedMs=clock.Elapsed.TotalMilliseconds;
    var body=JsonSerializer.SerializeToUtf8Bytes(result);Console.WriteLine(JsonSerializer.Serialize(new{elapsedMs,bytesAllocated,responseBytes=body.Length,sha256=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(body)),peakWorkingSetBytes=System.Diagnostics.Process.GetCurrentProcess().PeakWorkingSet64}));return 0;
}
if(args is ["--operation",var dataDirectory,var operation,var arguments]){using var automation=new AutomationService(new(Path.GetFullPath(dataDirectory),Meili.Core.Settings.DataDirectorySource.CommandLine));using var document=JsonDocument.Parse(arguments);Console.WriteLine((await automation.ExecuteAsync(operation,document.RootElement,false)).GetRawText());return 0;}
if(args is ["--capture-once",var onceDirectory]){
    if(Environment.GetEnvironmentVariable("MEILI_LIVE")!="1")throw new InvalidOperationException("Cloud capture requires MEILI_LIVE=1");
    using var services=new Meili.Data.DataServices(new Meili.Core.Settings.NetworkSettings());
    var market=new Meili.Data.Cache.CachedMarketData(services.Router,new Meili.Data.Cache.MarketDb(Path.Combine(onceDirectory,"cache","market.db")));
    var capture=await new QqqGexCaptureService(market,onceDirectory).CaptureAsync();
    Console.WriteLine(JsonSerializer.Serialize(new{stage="capture",data=capture}));
    var publish=await QqqGexCalculationRunner.RunAsync(onceDirectory);
    Console.WriteLine(JsonSerializer.Serialize(new{stage="publish",data=publish}));return 0;
}
if(args is ["--capture-sequence",var directory]){
    using var services=new Meili.Data.DataServices(new Meili.Core.Settings.NetworkSettings());var market=new Meili.Data.Cache.CachedMarketData(services.Router,new Meili.Data.Cache.MarketDb(Path.Combine(directory,"cache","market.db")));
    foreach(var context in new[]{false,true}){var clock=System.Diagnostics.Stopwatch.StartNew();var captured=await new QqqGexCaptureService(market,directory).CaptureAsync(includeContext:context);Console.WriteLine(JsonSerializer.Serialize(new{stage=context?"context-capture":"core-capture",seconds=clock.Elapsed.TotalSeconds,data=captured}));clock.Restart();var computed=await QqqGexCalculationRunner.RunAsync(directory);Console.WriteLine(JsonSerializer.Serialize(new{stage=context?"context-publish":"core-publish",seconds=clock.Elapsed.TotalSeconds,data=computed}));}return 0;
}
Console.Error.WriteLine("Cloud harness: --serve DB or --capture-sequence TEMP_DATA_DIR");return 2;
