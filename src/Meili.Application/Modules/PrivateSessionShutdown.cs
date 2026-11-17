using System.Net.Sockets;
namespace Meili.Automation.Modules;

/// <summary>Nonblocking native detach, awaitable developer cleanup, and one lease release after accepted requests drain.</summary>
internal sealed class PrivateSessionShutdown
{
    internal const int Capacity=8;
    private readonly object gate=new();
    private Task? shutdown;
    internal Task Begin(Func<Task> drain)
    {
        TaskCompletionSource completion;
        lock(gate)
        {
            if(shutdown is not null)return shutdown;
            completion=new(TaskCreationOptions.RunContinuationsAsynchronously);
            shutdown=completion.Task;
        }
        _=CompleteAsync();
        return completion.Task;
        async Task CompleteAsync()
        {
            try{await drain().ConfigureAwait(false);completion.TrySetResult();}
            catch(OperationCanceledException ex){completion.TrySetCanceled(ex.CancellationToken);}
            catch(Exception ex){completion.TrySetException(ex);}
        }
    }
    internal static async Task DrainAsync(Task acceptLoop,SemaphoreSlim clients,CancellationTokenSource stop,TcpListener listener,IDisposable? lease,Action? stopped=null,Action? drained=null)
    {
        try{stopped?.Invoke();}
        catch(Exception ex){Meili.Core.Diagnostics.AppLog.Warn("app-view","Private session observer cleanup failed",ex);}
        try{stop.Cancel();}
        catch(AggregateException ex){Meili.Core.Diagnostics.AppLog.Warn("app-view","Private session cancellation callback failed",ex);}
        listener.Stop();
        try
        {
            await acceptLoop.ConfigureAwait(false);
            for(var i=0;i<Capacity;i++)await clients.WaitAsync().ConfigureAwait(false);
        }
        finally
        {
            try{drained?.Invoke();}
            finally{lease?.Dispose();clients.Dispose();stop.Dispose();}
        }
    }
}
