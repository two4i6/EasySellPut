using System.Text.Json;
using Meili.Shared.Services;
using Meili.Automation;
// Cloud test harness only; never included in application distributions.
if(args is ["--serve",var database]){using var session=new QqqGexSession(Path.GetFullPath(database));Console.WriteLine(JsonSerializer.Serialize(new{pageUri=session.PageUri.AbsoluteUri}));await Console.In.ReadLineAsync();return 0;}
if(args is ["--operation",var dataDirectory,var operation,var arguments]){using var automation=new AutomationService(new(Path.GetFullPath(dataDirectory),Meili.Core.Settings.DataDirectorySource.CommandLine));using var document=JsonDocument.Parse(arguments);Console.WriteLine((await automation.ExecuteAsync(operation,document.RootElement,false)).GetRawText());return 0;}
if(args is ["--capture-sequence",var directory]){
    using var services=new Meili.Data.DataServices(new Meili.Core.Settings.NetworkSettings());var market=new Meili.Data.Cache.CachedMarketData(services.Router,new Meili.Data.Cache.MarketDb(Path.Combine(directory,"cache","market.db")));
    foreach(var context in new[]{false,true}){var clock=System.Diagnostics.Stopwatch.StartNew();var captured=await new QqqGexCaptureService(market,directory).CaptureAsync(includeContext:context);Console.WriteLine(JsonSerializer.Serialize(new{stage=context?"context-capture":"core-capture",seconds=clock.Elapsed.TotalSeconds,data=captured}));clock.Restart();var computed=await QqqGexCalculationRunner.RunAsync(directory);Console.WriteLine(JsonSerializer.Serialize(new{stage=context?"context-publish":"core-publish",seconds=clock.Elapsed.TotalSeconds,data=computed}));}return 0;
}
Console.Error.WriteLine("Cloud harness: --serve DB or --capture-sequence TEMP_DATA_DIR");return 2;
