using System.Text.Json;
using Meili.Automation.Modules;
using Meili.Core.Abstractions;
using Meili.Core.Models;
using Meili.Core.Settings;
namespace Meili.Automation.Tests;
public sealed class ModuleSchedulingTests : IDisposable
{
    private readonly string root=Path.Combine(Path.GetTempPath(),"module-scheduling-"+Guid.NewGuid().ToString("N"));
    private sealed class SlowStream : IQuoteStreamSource
    {
        public string SourceId=>"fixture";
        public TaskCompletionSource Ready {get;}=new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async IAsyncEnumerable<QuoteTick> WatchAsync(IReadOnlyList<string> symbols,[System.Runtime.CompilerServices.EnumeratorCancellation]CancellationToken ct=default)
        {Ready.TrySetResult();await Task.Delay(Timeout.Infinite,ct);yield break;}
    }
    [Fact] public async Task Pure_pricing_completes_while_same_service_is_waiting_on_a_live_stream()
    {
        var source=new SlowStream();using var service=new AutomationService(new(root,DataDirectorySource.CommandLine),quoteStream:source);
        using var stop=new CancellationTokenSource();
        var slow=service.ExecuteAsync("get_live_quotes",WireJson.Element(new{symbols=new[]{"QQQ"},seconds=20}),false,stop.Token);
        await source.Ready.Task.WaitAsync(TimeSpan.FromSeconds(5));
        try
        {
            var result=await service.ExecuteAsync("calculate_option",WireJson.Element(new{right="call",spot=100,strike=100,years=1,volatility=.2}),false).WaitAsync(TimeSpan.FromSeconds(3));
            Assert.True(result.GetProperty("success").GetBoolean());Assert.False(slow.IsCompleted);
        }
        finally{stop.Cancel();try{await slow;}catch(OperationCanceledException){}}
    }
    [Fact] public async Task Same_app_work_is_exclusive_waiters_cancel_and_other_apps_proceed()
    {
        using var first=await ModuleJobs.AcquireAsync(root,"easysellput.first",CancellationToken.None);
        using var deadline=new CancellationTokenSource(TimeSpan.FromMilliseconds(250));
        var waiting=ModuleJobs.AcquireAsync(root,"easysellput.first",deadline.Token);
        using var reader=await ModuleJobs.AcquireAsync(root,"easysellput.first",CancellationToken.None,readOnly:true);
        using var other=await ModuleJobs.AcquireAsync(root,"easysellput.other",CancellationToken.None);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>waiting);
        first.Dispose();
        using var next=await ModuleJobs.AcquireAsync(root,"easysellput.first",CancellationToken.None);
    }
    [Fact] public async Task Same_app_waiters_do_not_consume_all_cpu_slots_or_block_another_app()
    {
        using var owner=await ModuleJobs.AcquireAsync(root,"easysellput.first",CancellationToken.None);
        using var stop=new CancellationTokenSource();
        var waiters=Enumerable.Range(0,5).Select(_=>ModuleJobs.AcquireAsync(root,"easysellput.first",stop.Token)).ToArray();
        try
        {
            using var other=await ModuleJobs.AcquireAsync(root,"easysellput.other",CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(3));
        }
        finally{stop.Cancel();foreach(var task in waiters)try{using var ticket=await task;}catch(OperationCanceledException){}}
    }
    public void Dispose(){if(Directory.Exists(root))Directory.Delete(root,true);}
}
