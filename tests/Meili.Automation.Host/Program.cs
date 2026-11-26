using Meili.Automation;
using Meili.Automation.Tests;

if(args.Length==3 && args[0] is "--module-job" or "--module-job-probe")
{
    using var deadline=new CancellationTokenSource(args[0]=="--module-job-probe"?TimeSpan.FromMilliseconds(300):TimeSpan.FromSeconds(20));
    try
    {
        using var job=await Meili.Automation.Modules.ModuleJobs.AcquireAsync(args[1],args[2],deadline.Token);
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new{acquired=true}));
        if(args[0]=="--module-job")await Console.In.ReadLineAsync();
    }
    catch(OperationCanceledException){Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new{acquired=false}));}
    return 0;
}

if(args.Length==3 && args[0]=="--module-lease")
{
    using var lease=new Meili.Automation.Modules.ModuleRegistry(args[1]).AcquireExecution(args[2]);
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new{ready=true}));
    await Console.In.ReadLineAsync();
    return 0;
}

// Exact pre-migration view oracle; test host only and no provider/network access.
if(args.Length==5&&args[0]=="--gex-legacy-view")
{
    using var request=System.Text.Json.JsonDocument.Parse(args[2]);
    async Task<object> OriginalQuery(string path,CancellationToken ct)
    {
        var start=new System.Diagnostics.ProcessStartInfo(args[3]){UseShellExecute=false,RedirectStandardOutput=true,RedirectStandardError=true};
        start.ArgumentList.Add(args[4]);start.ArgumentList.Add(Path.Combine(args[1],"cache","qqq-gex.db"));start.ArgumentList.Add(path);
        using var process=System.Diagnostics.Process.Start(start)!;var output=process.StandardOutput.ReadToEndAsync(ct);var errors=process.StandardError.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct);var body=await output;await errors;
        if(process.ExitCode!=0)return new{status="calculation_failed",complete=false,exitCode=process.ExitCode,reason="Pinned source runtime rejected input; raw normalized input retained"};
        using var json=System.Text.Json.JsonDocument.Parse(body);return json.RootElement.Clone();
    }
    var adapter=new Meili.Automation.Apps.QqqGex.GexLegacyOperations(args[1],_=>throw new InvalidOperationException("Read-only view requested market access"),OriginalQuery);
    var result=await adapter.ExecuteAsync("get_qqq_gex_view",new Meili.Automation.Input(request.RootElement),CancellationToken.None);
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result));return 0;
}

if(args.Length==3&&args[0]=="--gex-app-fixture-build"){GexAppFixture.Create(args[1],args[2]);return 0;}
if(args.Length==2 && args[0]=="--app-fixture-build") { AppFixture.Create(args[1]); return 0; }

if(args.Length is 2 or 3&&args[0]=="--gex-capture-original")
{
    try
    {
        var result=await new QqqGexCaptureService(GexCaptureFixture.Market(args.Length==3?args[2]:"aligned"),args[1]).CaptureAsync();
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result));return 0;
    }
    catch(Meili.Data.Http.DataSourceException error){Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(WireJson.Error(error)));return 1;}
}
if(args.Length>=5&&args[0]=="--app-capture-fixture-mode")return await AppFixture.RunAsync(args[1],args[2],args[4..],args[3]);
if(args.Length>=4&&args[0]=="--app-capture-fixture")return await AppFixture.RunAsync(args[1],args[2],args[3..],"aligned");

// Temporary-key app tests use this host only; production CLI has no equivalent switch.
if(args.Length >= 4 && args[0]=="--app-fixture")
    return await AppFixture.RunAsync(args[1],args[2],args[3..]);

// Explicit opt-in live soak; test host only, never included in the shipped CLI.
if(args.SequenceEqual(new[]{"--live-quote-probe"}))
{
    if(Environment.GetEnvironmentVariable("MEILI_LIVE")!="1")throw new InvalidOperationException("Live probe requires MEILI_LIVE=1.");
    using var stop=new CancellationTokenSource(TimeSpan.FromMinutes(2));var watch=System.Diagnostics.Stopwatch.StartNew();
    var settings=new Meili.Core.Settings.NetworkSettings();var proxy=await Meili.Data.Http.ProxyDetector.ResolveAsync(settings,stop.Token);
    using var data=new Meili.Data.DataServices(settings,proxy);var source=new Meili.Data.Providers.Yahoo.YahooQuoteStream(data.Gateway);
    var counts=new Dictionary<string,int>();var last=new Dictionary<string,Meili.Core.Models.QuoteTick>();var receive=new Dictionary<string,double>();var maxGap=new Dictionary<string,double>();
    var errors=new List<string>();var backwards=0;double maxLag=0;
    try{await foreach(var tick in new Meili.Shared.Services.QuoteStreamingService(source).WatchAsync(["AAPL","SPY","QQQ","MSFT","NVDA","TSLA"],errors.Add,stop.Token))
    {
        var now=watch.Elapsed.TotalSeconds;counts[tick.Symbol]=counts.GetValueOrDefault(tick.Symbol)+1;
        if(last.TryGetValue(tick.Symbol,out var old)&&tick.Time<old.Time)backwards++;
        if(receive.TryGetValue(tick.Symbol,out var prior))maxGap[tick.Symbol]=Math.Max(maxGap.GetValueOrDefault(tick.Symbol),now-prior);
        maxLag=Math.Max(maxLag,(DateTimeOffset.UtcNow-tick.Time).TotalSeconds);last[tick.Symbol]=tick;receive[tick.Symbol]=now;
    }}catch(OperationCanceledException)when(stop.IsCancellationRequested){}
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new{live=true,transport="websocket",seconds=watch.Elapsed.TotalSeconds,counts,interruptions=errors,sourceTimeRegressions=backwards,maxMeasuredLagSeconds=maxLag,maxReceiveGapSeconds=maxGap,last=last.Values}));
    return counts.Count==6?0:1;
}

if(args.Length==5 && args[0]=="--update-transaction"){await UpdateFixture.RunAsync(args[1],args[2],args[3],args[4]);return 0;}

if (args.SequenceEqual(new[] { "--connection-fixtures" }))
{
    var values = new[] {
        new McpConnectionSetup("/Applications/My App's 🚀/easysellput", "/tmp/中文 data '$HOME' $(echo unsafe)", false),
        new McpConnectionSetup(@"C:\Program Files\My App's 🚀\easysellput.exe", @"C:\Users\测试\data '$HOME' $(echo unsafe)", true)
    };
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(values.Select(v => new {v.Executable,v.DataDirectory,v.Windows,v.Arguments,v.Json,v.Toml,v.CodexCommand,v.ClaudeCommand,v.CodexSetupCommand,v.ClaudeSetupCommand})));
    return 0;
}

// Test-only executable: real CLI/MCP adapters and official SDK, deterministic market data.
// This host is never shipped in the production distribution.
return await Meili.Cli.Program.RunAsync(args, directory => new AutomationService(directory, new FakeMarket(), [new FixtureProbe()], new Meili.Testing.LiquidityFixture(), Meili.Testing.LiquidityFixture.Clock,new Meili.Testing.QuoteStreamFixture(),liveBarMarket:new FakeMarket{BarsOverride=(r,_)=>Task.FromResult(Meili.Testing.LiveBarHistoryFixture.Series(r))},liveClock:Meili.Testing.LiquidityFixture.Clock));

sealed class FixtureProbe : Meili.Core.Abstractions.IQuoteProvider
{
    public string Id=>"fixture";
    public string DisplayName=>"Offline fixture probe";
    public Meili.Core.Models.DataCapability Capabilities=>Meili.Core.Models.DataCapability.Quote;
    public Task<IReadOnlyList<Meili.Core.Models.Quote>> GetQuotesAsync(IReadOnlyList<string> symbols,CancellationToken ct=default)=>Task.FromResult<IReadOnlyList<Meili.Core.Models.Quote>>([new(){Symbol="AAPL",Price=100,Source="fixture"}]);
}
