using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Meili.Core.Settings;
namespace Meili.Automation;

/// <summary>Runs only the bundled, hash-verified original GEX model. No caller-selected executable or script.</summary>
public static class QqqGexCalculationRunner
{
    // Compatibility aliases for callers/tests; runtime ownership is application-independent.
    internal static string BundledArchivePath(string baseDirectory,string archiveName)=>Modules.PinnedNodeRuntime.BundledArchivePath(baseDirectory,archiveName);
    internal static Task<string?> ExtractNodeAsync(string directory,CancellationToken ct)=>Modules.PinnedNodeRuntime.ExtractNodeAsync(directory,ct);
    private static readonly SemaphoreSlim QueryGate=new(1);
    public static Task<object> RebuildHistoryAsync(string directory,int limit,bool retryFailed,CancellationToken ct=default)
    {
        if(limit is <1 or >400)throw new ArgumentOutOfRangeException(nameof(limit));
        return ExecuteAsync(directory,"history.mjs",JsonSerializer.Serialize(new {limit,retryFailed}),ct);
    }
    public static async Task<object> RunAsync(string directory,CancellationToken ct=default)
    {
        var discovery=await Modules.ModuleOperations.ReadSnapshotAsync(directory,ct).ConfigureAwait(false);discovery.RequireAvailable(Modules.ModuleAccess.QqqGex);
        var operation=discovery.Operations.SingleOrDefault(item=>item.AppId==Modules.ModuleAccess.QqqGex&&item.Definition.Name=="calculate_qqq_gex_local");
        return operation is null?await ExecuteAsync(directory,"import.mjs",null,ct).ConfigureAwait(false):await Modules.ModuleProcess.ExecuteAsync(directory,operation,JsonSerializer.SerializeToElement(new{}),true,ct).ConfigureAwait(false);
    }
    public static async Task<object> QueryAsync(string directory,string path,CancellationToken ct=default)
    {
        if(Encoding.UTF8.GetByteCount(path)>65536||!(path.StartsWith("/api/analysis/qqq/local-analysis?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/local-archive?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/pcs/backtest?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/pcs?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/gex/intraday-context?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/gex/exposure?",StringComparison.Ordinal)||(path=="/api/analysis/qqq/pcs/local-decision"||path.StartsWith("/api/analysis/qqq/pcs/local-decision?",StringComparison.Ordinal))))throw new ArgumentException("Unsupported local query");
        await QueryGate.WaitAsync(ct);try{return await ExecuteAsync(directory,"query.mjs",path,ct);}finally{QueryGate.Release();}
    }
    private static async Task<object> ExecuteAsync(string directory,string script,string? query,CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        using var execution=Meili.Automation.Modules.ModuleAccess.AcquireEnabled(directory,"easysellput.qqq-gex");
        using var job=await Meili.Automation.Modules.ModuleJobs.AcquireAsync(directory,"easysellput.qqq-gex",ct,readOnly:script=="query.mjs").ConfigureAwait(false);
        using var installed=await Meili.Automation.Modules.ModuleAssets.TryOpenAsync(directory,"easysellput.qqq-gex","engine/"+script,ct);
        using var asset=installed?.OpenRead()??typeof(QqqGexCalculationRunner).Assembly.GetManifestResourceStream("QqqGexRuntime/"+script);
        if(asset is null)return new {status="runtime_unavailable",complete=false,reason="Bundled GEX calculation resource is missing"};
        using var memory=new MemoryStream();await asset.CopyToAsync(memory,ct);var bytes=memory.ToArray();var hash=Convert.ToHexString(SHA256.HashData(bytes));
        var runtime=installed is null?Path.Combine(directory,"cache","qqq-runtime",hash+".mjs"):await installed.MaterializeScriptAsync(ct);Directory.CreateDirectory(Path.GetDirectoryName(runtime)!);
        if(File.Exists(runtime)){if(!SHA256.HashData(await File.ReadAllBytesAsync(runtime,ct)).SequenceEqual(SHA256.HashData(bytes)))throw new InvalidDataException("Bundled GEX runtime integrity check failed");}
        else new SnapshotFile(runtime).Write(Encoding.UTF8.GetString(bytes));
        var executable=await ExtractNodeAsync(directory,ct);
        if(executable is null)return new {status="runtime_unavailable",complete=false,reason="Pinned bundled Node archive is missing for this platform"};
        var queryStdin=script=="query.mjs"&&query is not null&&query.Length>8192;
        var start=new ProcessStartInfo(executable){UseShellExecute=false,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=queryStdin,CreateNoWindow=true};
        start.Environment.Remove("NODE_OPTIONS");start.Environment.Remove("NODE_PATH");start.Environment.Remove("NODE_ICU_DATA");
        start.ArgumentList.Add(runtime);
        if(query is null){start.ArgumentList.Add(Path.Combine(directory,"cache","qqq-gex-input.json"));start.ArgumentList.Add(Path.Combine(directory,"cache","qqq-gex.db"));}
        else {start.ArgumentList.Add(Path.Combine(directory,"cache","qqq-gex.db"));start.ArgumentList.Add(queryStdin?"--query-stdin":query);}
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromMinutes(2));
        Process? process;
        try{process=Process.Start(start);}catch(System.ComponentModel.Win32Exception){return new {status="runtime_unavailable",complete=false,reason="Node 24+ is required; no runtime is downloaded or installed automatically"};}
        if(process is null)return new {status="runtime_unavailable",complete=false};
        using(process)
        {
            async Task<byte[]> ReadBounded(Stream stream,int limit){using var buffer=new MemoryStream();var chunk=new byte[8192];int n;while((n=await stream.ReadAsync(chunk,timeout.Token))>0){if(buffer.Length+n>limit){try{process.Kill(true);}catch(InvalidOperationException){}throw new InvalidDataException("GEX process output exceeds bound");}buffer.Write(chunk,0,n);}return buffer.ToArray();}
            var outputLimit=script=="query.mjs"?128*1024*1024:1024*1024;var stdout=ReadBounded(process.StandardOutput.BaseStream,outputLimit);var stderr=ReadBounded(process.StandardError.BaseStream,65536);
            if(queryStdin){await process.StandardInput.BaseStream.WriteAsync(Encoding.UTF8.GetBytes(query!),timeout.Token);process.StandardInput.Close();}
            try{await process.WaitForExitAsync(timeout.Token);}catch(OperationCanceledException){try{process.Kill(true);}catch(InvalidOperationException){}throw;}
            var output=await stdout;_ =await stderr;
            if(process.ExitCode!=0||output.Length>outputLimit)return new {status="calculation_failed",complete=false,exitCode=process.ExitCode,reason="Pinned source runtime rejected input; raw normalized input retained"};
            // Parse bounded UTF-8 without a full UTF-16 stdout copy; clone preserves the existing independently owned JsonElement contract.
            using var doc=JsonDocument.Parse(output);return doc.RootElement.Clone();
        }
    }
}
