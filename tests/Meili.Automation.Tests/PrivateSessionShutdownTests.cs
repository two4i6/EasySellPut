using Meili.Automation.Modules;
namespace Meili.Automation.Tests;
public sealed class PrivateSessionShutdownTests
{
    [Fact]
    public async Task Reentrant_detach_reuses_pending_drain_and_releases_once()
    {
        var shutdown=new PrivateSessionShutdown();
        var release=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Task? nested=null;var calls=0;
        var first=shutdown.Begin(async()=>
        {
            calls++;
            nested=shutdown.Begin(()=>throw new InvalidOperationException("Duplicate drain"));
            await release.Task;
        });
        Assert.Same(first,nested);Assert.False(first.IsCompleted);Assert.Equal(1,calls);
        release.SetResult();await first;
        Assert.Same(first,shutdown.Begin(()=>throw new InvalidOperationException("Repeated detach")));
    }
    [Fact]
    public async Task Synchronous_cleanup_failure_is_observable_and_not_retried()
    {
        var shutdown=new PrivateSessionShutdown();
        var first=shutdown.Begin(()=>throw new IOException("cleanup failed"));
        await Assert.ThrowsAsync<IOException>(()=>first);
        Assert.Same(first,shutdown.Begin(()=>Task.CompletedTask));
    }
}
