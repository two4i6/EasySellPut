using System.Text.Json;
namespace Meili.Automation.Modules;
/// <summary>One exact authorized host mutation. Success cannot be forged by omitting or ignoring the host call.</summary>
internal sealed class ModuleWriteGrant(string operation,JsonElement arguments,bool allowWrites,
    Func<string,JsonElement,CancellationToken,Task<JsonElement>> read,
    Func<string,JsonElement,CancellationToken,Task<JsonElement>> write)
{
    private int used,applied;
    internal async Task<JsonElement> InvokeAsync(string name,JsonElement args,CancellationToken ct)
    {
        if(!OptionsStrategyContracts.IsWrite(name))return await read(name,args,ct).ConfigureAwait(false);
        if(!allowWrites || ModuleAccess.OperationOwner(operation)!=ModuleAccess.OptionsStrategy || name!=operation ||
            !JsonElement.DeepEquals(arguments,args) || Interlocked.Exchange(ref used,1)!=0)
            throw new UnauthorizedAccessException("Mutation is not the single exact authorized request.");
        ct.ThrowIfCancellationRequested();var result=await write(name,args,ct).ConfigureAwait(false);
        Volatile.Write(ref applied,1);return result;
    }
    internal void RequireApplied()
    {
        if(OptionsStrategyContracts.IsWrite(operation) && Volatile.Read(ref applied)!=1)
            throw new InvalidDataException("App returned success without applying the authorized host mutation.");
    }
}
