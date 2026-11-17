namespace Meili.Automation.Modules;

/// <summary>Bounded per-process admission plus real per-app cross-process heavy-work exclusion.</summary>
public static class ModuleJobs
{
    private static readonly SemaphoreSlim Admission = new(16);
    private static readonly SemaphoreSlim Active = new(4);
    public static async Task<IDisposable> AcquireAsync(string directory, string id, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if(!await Admission.WaitAsync(0,ct).ConfigureAwait(false))throw new InvalidOperationException("Application work queue is full; retry after active requests finish.");
        var active=false;
        using var deadline=CancellationTokenSource.CreateLinkedTokenSource(ct);deadline.CancelAfter(TimeSpan.FromSeconds(30));
        try
        {
            await Active.WaitAsync(deadline.Token).ConfigureAwait(false);active=true;
            var registry=new ModuleRegistry(directory);
            while(true)
            {
                deadline.Token.ThrowIfCancellationRequested();
                try{return new Ticket(registry.AcquireJob(id));}
                catch(IOException){await Task.Delay(80,deadline.Token).ConfigureAwait(false);}
            }
        }
        catch{if(active)Active.Release();Admission.Release();throw;}
    }
    private sealed class Ticket(IDisposable lease):IDisposable
    {
        private IDisposable? owner=lease;
        public void Dispose()
        {
            var held=Interlocked.Exchange(ref owner,null);if(held is null)return;
            held.Dispose();Active.Release();Admission.Release();
        }
    }
}
