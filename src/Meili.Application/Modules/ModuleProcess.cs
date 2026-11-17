using Meili.Core.Diagnostics;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Meili.Automation.Modules;

/// <summary>First-party, signed, bounded JSON engine. Process isolation is not an untrusted-code sandbox.</summary>
public static partial class ModuleProcess
{
    public static Task<JsonElement> ExecuteAsync(string directory, BoundModuleOperation operation, JsonElement arguments, bool allowWrites, CancellationToken ct, Func<string,JsonElement,CancellationToken,Task<JsonElement>>? hostCall = null) =>
        ExecuteAsync(directory, operation, arguments, allowWrites, new ModuleInstaller(directory), token => PinnedNodeRuntime.ExtractNodeAsync(directory, token), ct, hostCall);

    internal static async Task<JsonElement> ExecuteAsync(string directory, BoundModuleOperation operation, JsonElement arguments, bool allowWrites,
        ModuleInstaller installer, Func<CancellationToken, Task<string?>> runtime, CancellationToken ct, Func<string,JsonElement,CancellationToken,Task<JsonElement>>? hostCall = null)
    {
        if (operation.Definition.Writes && !allowWrites) throw new UnauthorizedAccessException();
        using var lease = new ModuleRegistry(directory).AcquireExecution(operation.AppId);
        using var job = await ModuleJobs.AcquireAsync(directory, operation.AppId, ct, readOnly: !operation.Definition.Writes).ConfigureAwait(false);
        // Resolve again under the lease: a queued request must not silently run a changed contract.
        var discovery=await ModuleOperations.ReadSnapshotAsync(directory,installer,ct).ConfigureAwait(false);
        discovery.RequireAvailable(operation.AppId);
        var current = discovery.Operations.SingleOrDefault(o => o.Definition.Name == operation.Definition.Name);
        if (current is null || current.AppId != operation.AppId || current.Version != operation.Version || current.PackageSha256 != operation.PackageSha256)
            throw new InvalidOperationException("Application changed; repeat discovery and retry.");
        OperationCatalog.Validate(new(current.Definition.Name, current.Definition.Description, current.Definition.Writes, current.Definition.Schema), arguments);
        if (current.Definition.Writes && !allowWrites) throw new UnauthorizedAccessException();
        using var asset = await ModuleAssets.TryOpenAsync(directory, current.AppId, current.Definition.EntryPoint, installer, ct).ConfigureAwait(false)
            ?? throw new InvalidDataException("Installed module entrypoint is unavailable.");
        var script = await asset.MaterializeScriptAsync(ct).ConfigureAwait(false);
        var node = await runtime(ct).ConfigureAwait(false)
            ?? throw new InvalidOperationException("Pinned Node runtime is unavailable; install a complete host package.");
        var dependencies=new Dictionary<string,string>(StringComparer.Ordinal);
        foreach(var dependency in current.Definition.EngineAssets??[])
        {
            using var companion=await ModuleAssets.TryOpenAsync(directory,current.AppId,dependency,installer,ct).ConfigureAwait(false)??throw new InvalidDataException("Signed engine dependency is unavailable.");
            dependencies.Add(dependency,await companion.MaterializeScriptAsync(ct).ConfigureAwait(false));
        }
        if(current.Definition.HostOperations is {Length:>0} operations)
        {
            if(hostCall is null&&operations.Any(name=>name is not ("read_app_snapshot" or "write_app_input")))throw new InvalidOperationException("This host cannot supply the application's declared host capabilities.");
            using var inputWriter=new ModuleInputWriter(directory,current.AppId,current.Definition.Writes&&allowWrites);
            return await RunHostAsync(node,script,new{protocol=1,framing="host-jsonl-v1",operation=current.Definition.Name,arguments,
                context=new{dataDirectory=Path.GetFullPath(directory),appId=current.AppId,appVersion=current.Version,allowWrites=current.Definition.Writes&&allowWrites,hostOperations=operations,maxHostCalls=operations.Contains("write_app_input")?1024:256,assets=dependencies}},operations,(name,args,token)=>name=="read_app_snapshot"?Task.FromResult(ModuleState.Read(directory,current.AppId,args.GetProperty("key").GetString()!)):name=="write_app_input"?Task.FromResult(inputWriter.Write(args)):hostCall!(name,args,token),ct).ConfigureAwait(false);
        }
        return await RunAsync(node, script, new { protocol = 1, operation = current.Definition.Name, arguments,
            context = new { dataDirectory = Path.GetFullPath(directory), appId = current.AppId, appVersion = current.Version, allowWrites = current.Definition.Writes && allowWrites, assets=dependencies } }, ct).ConfigureAwait(false);
    }

    internal static JsonElement DecodeResult(JsonElement value)
    {
        if(value.ValueKind!=JsonValueKind.Object||!value.TryGetProperty("$appError",out var error))return value.Clone();
        if(value.EnumerateObject().Count()!=1||error.ValueKind!=JsonValueKind.Object||!error.TryGetProperty("code",out var code)||code.ValueKind!=JsonValueKind.String||!error.TryGetProperty("message",out var text)||text.ValueKind!=JsonValueKind.String||text.GetString()!.Length>1000)
            throw new InvalidDataException("Malformed application error.");
        var message=text.GetString();
        throw code.GetString() switch
        {
            "invalid_arguments"=>new ArgumentException(message),
            "permission_denied"=>new UnauthorizedAccessException(message),
            "cancelled"=>new OperationCanceledException(message),
            "data_conflict"=>new Meili.Core.Settings.DataConflictException("application input"),
            "data_source_error" or "io_error"=>new ModuleOperationFailure(code.GetString()!,message!),
            _=>new InvalidDataException(message)
        };
    }

    internal static async Task<JsonElement> RunAsync(string executable, string script, object request, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add(script);
        foreach (var name in new[] { "NODE_OPTIONS", "NODE_PATH", "NODE_ICU_DATA" }) start.Environment.Remove(name);
        var input = JsonSerializer.SerializeToUtf8Bytes(request, WireJson.Options);
        if (input.Length > 1048576) throw new ArgumentException("Module request exceeds bound.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct); deadline.CancelAfter(TimeSpan.FromMinutes(2));
        using var process = Process.Start(start) ?? throw new IOException("Cannot start app engine.");
        async Task<byte[]> Read(Stream stream, int limit)
        {
            using var output = new MemoryStream(); var buffer = new byte[16384]; int count;
            while ((count = await stream.ReadAsync(buffer, deadline.Token).ConfigureAwait(false)) > 0)
            {
                if (output.Length + count > limit) { deadline.Cancel(); throw new InvalidDataException("Module output exceeds bound."); }
                output.Write(buffer, 0, count);
            }
            return output.ToArray();
        }
        var stdout = Read(process.StandardOutput.BaseStream, 16 * 1024 * 1024);
        var stderr = Read(process.StandardError.BaseStream, 65536);
        try
        {
            await WriteProtocolInputAsync(process,input,newline:false,deadline.Token).ConfigureAwait(false); process.StandardInput.Close();
            await process.WaitForExitAsync(deadline.Token).ConfigureAwait(false);
            var output = await stdout.ConfigureAwait(false); await stderr.ConfigureAwait(false);
            if (process.ExitCode != 0) throw new InvalidDataException("Application engine failed; retained input/data were not rolled back.");
            using var document = JsonDocument.Parse(output, new JsonDocumentOptions { MaxDepth = 64 });
            return DecodeResult(document.RootElement);
        }
        finally
        {
            if (!process.HasExited) try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            // Observe read faults even when input, timeout or process startup fails.
            try { await Task.WhenAll(stdout, stderr).ConfigureAwait(false); } catch (Exception e) when (e is IOException or OperationCanceledException or InvalidDataException)
            {
                // expected: cancellation is already propagated by the primary await.
                // Preserve that original failure while recording unexpected cleanup I/O.
                if (e is not OperationCanceledException) AppLog.Warn("apps", "Engine stream cleanup failed", e);
            }
        }
    }
}

internal sealed class ModuleOperationFailure(string code,string message):Exception(message)
{
    internal string Code {get;}=code;
}
