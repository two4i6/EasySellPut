using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Meili.Automation.Modules;

/// <summary>First-party, signed, bounded JSON engine. Process isolation is not an untrusted-code sandbox.</summary>
public static class ModuleProcess
{
    public static Task<JsonElement> ExecuteAsync(string directory, BoundModuleOperation operation, JsonElement arguments, bool allowWrites, CancellationToken ct) =>
        ExecuteAsync(directory, operation, arguments, allowWrites, new ModuleInstaller(directory), token => QqqGexCalculationRunner.ExtractNodeAsync(directory, token), ct);

    internal static async Task<JsonElement> ExecuteAsync(string directory, BoundModuleOperation operation, JsonElement arguments, bool allowWrites,
        ModuleInstaller installer, Func<CancellationToken, Task<string?>> runtime, CancellationToken ct)
    {
        if (operation.Definition.Writes && !allowWrites) throw new UnauthorizedAccessException();
        using var lease = new ModuleRegistry(directory).AcquireExecution(operation.AppId);
        // Resolve again under the lease: a queued request must not silently run a changed contract.
        var current = (await ModuleOperations.ReadAsync(directory, installer, ct).ConfigureAwait(false)).SingleOrDefault(o => o.Definition.Name == operation.Definition.Name);
        if (current is null || current.AppId != operation.AppId || current.Version != operation.Version)
            throw new InvalidOperationException("Application changed; repeat discovery and retry.");
        OperationCatalog.Validate(new(current.Definition.Name, current.Definition.Description, current.Definition.Writes, current.Definition.Schema), arguments);
        if (current.Definition.Writes && !allowWrites) throw new UnauthorizedAccessException();
        using var asset = await ModuleAssets.TryOpenAsync(directory, current.AppId, current.Definition.EntryPoint, installer, ct).ConfigureAwait(false)
            ?? throw new InvalidDataException("Installed module entrypoint is unavailable.");
        var script = await asset.MaterializeScriptAsync(ct).ConfigureAwait(false);
        var node = await runtime(ct).ConfigureAwait(false)
            ?? throw new InvalidOperationException("Pinned Node runtime is unavailable; install a complete host package.");
        return await RunAsync(node, script, new { protocol = 1, operation = current.Definition.Name, arguments,
            context = new { dataDirectory = Path.GetFullPath(directory), appId = current.AppId, appVersion = current.Version, allowWrites = current.Definition.Writes && allowWrites } }, ct).ConfigureAwait(false);
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
            await process.StandardInput.BaseStream.WriteAsync(input, deadline.Token).ConfigureAwait(false); process.StandardInput.Close();
            await process.WaitForExitAsync(deadline.Token).ConfigureAwait(false);
            var output = await stdout.ConfigureAwait(false); await stderr.ConfigureAwait(false);
            if (process.ExitCode != 0) throw new InvalidDataException("Application engine failed; retained input/data were not rolled back.");
            using var document = JsonDocument.Parse(output, new JsonDocumentOptions { MaxDepth = 64 });
            return document.RootElement.Clone();
        }
        finally
        {
            if (!process.HasExited) try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            // Observe read faults even when input, timeout or process startup fails.
            try { await Task.WhenAll(stdout, stderr).ConfigureAwait(false); } catch (Exception e) when (e is IOException or OperationCanceledException or InvalidDataException) { }
        }
    }
}
