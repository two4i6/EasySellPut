using System.Text.Json;
using Meili.Shared.Services;
using Meili.Automation;
// Cloud test harness only; never included in application distributions.
if(args is ["--serve",var database]){using var session=new QqqGexSession(Path.GetFullPath(database));Console.WriteLine(JsonSerializer.Serialize(new{pageUri=session.PageUri.AbsoluteUri}));await Console.In.ReadLineAsync();return 0;}
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
if(args is ["--capture-sequence",var directory]){
    using var services=new Meili.Data.DataServices(new Meili.Core.Settings.NetworkSettings());var market=new Meili.Data.Cache.CachedMarketData(services.Router,new Meili.Data.Cache.MarketDb(Path.Combine(directory,"cache","market.db")));
    foreach(var context in new[]{false,true}){var clock=System.Diagnostics.Stopwatch.StartNew();var captured=await new QqqGexCaptureService(market,directory).CaptureAsync(includeContext:context);Console.WriteLine(JsonSerializer.Serialize(new{stage=context?"context-capture":"core-capture",seconds=clock.Elapsed.TotalSeconds,data=captured}));clock.Restart();var computed=await QqqGexCalculationRunner.RunAsync(directory);Console.WriteLine(JsonSerializer.Serialize(new{stage=context?"context-publish":"core-publish",seconds=clock.Elapsed.TotalSeconds,data=computed}));}return 0;
}
Console.Error.WriteLine("Cloud harness: --serve DB or --capture-sequence TEMP_DATA_DIR");return 2;
