using System.Diagnostics;
using System.Formats.Tar;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Meili.Core.Settings;
namespace Meili.Automation;

/// <summary>Runs only the bundled, hash-verified original GEX model. No caller-selected executable or script.</summary>
public static class QqqGexCalculationRunner
{
    internal static string BundledArchivePath(string baseDirectory,string archiveName)
    {
        var root=Path.TrimEndingDirectorySeparator(baseDirectory);return Path.GetFileName(root)=="MacOS"&&Path.GetFileName(Path.GetDirectoryName(root))=="Contents"?Path.GetFullPath(Path.Combine(root,"..","Resources","runtime",archiveName)):Path.Combine(root,"runtime",archiveName);
    }
    private static async Task<string?> ExtractNodeAsync(string directory,CancellationToken ct)
    {
        using var manifest=typeof(QqqGexCalculationRunner).Assembly.GetManifestResourceStream("QqqGexRuntime/node-lock.json")!;
        using var doc=await JsonDocument.ParseAsync(manifest,cancellationToken:ct);
        var rid=(OperatingSystem.IsWindows()?"win":OperatingSystem.IsMacOS()?"osx":"linux")+"-"+RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant();
        if(!doc.RootElement.GetProperty("platforms").TryGetProperty(rid,out var entry))return null;
        var name=entry.GetProperty("archive").GetString()!;var archive=BundledArchivePath(AppContext.BaseDirectory,name);
        if(!File.Exists(archive))return null;
        await using var file=File.OpenRead(archive);var archiveHash=Convert.ToHexString(await SHA256.HashDataAsync(file,ct));
        if(!archiveHash.Equals(entry.GetProperty("archiveSha256").GetString(),StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Bundled Node archive checksum mismatch");file.Position=0;
        var binaryHash=entry.GetProperty("executableSha256").GetString()!;var target=Path.Combine(directory,"cache","qqq-runtime",binaryHash,OperatingSystem.IsWindows()?"node.exe":"node");
        if(File.Exists(target)){await using var existing=File.OpenRead(target);if(!Convert.ToHexString(await SHA256.HashDataAsync(existing,ct)).Equals(binaryHash,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Extracted Node checksum mismatch");return target;}
        var prefix=name.EndsWith(".zip",StringComparison.Ordinal)?name[..^4]:name[..^7];var member=prefix+(OperatingSystem.IsWindows()?"/node.exe":"/bin/node");using var data=new MemoryStream();
        if(name.EndsWith(".zip",StringComparison.Ordinal)){using var zip=new ZipArchive(file,ZipArchiveMode.Read,true);using var input=zip.GetEntry(member)?.Open()??throw new InvalidDataException("Node executable missing");await input.CopyToAsync(data,ct);}
        else {using var gzip=new GZipStream(file,CompressionMode.Decompress,true);using var tar=new TarReader(gzip,true);TarEntry? part;var found=false;while((part=await tar.GetNextEntryAsync(cancellationToken:ct)) is not null){if(part.Name!=member)continue;if(part.EntryType is not (TarEntryType.RegularFile or TarEntryType.V7RegularFile))throw new InvalidDataException("Node executable is not a file");await part.DataStream!.CopyToAsync(data,ct);found=true;break;}if(!found)throw new InvalidDataException("Node executable missing");}
        var bytes=data.ToArray();if(!Convert.ToHexString(SHA256.HashData(bytes)).Equals(binaryHash,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Node executable checksum mismatch");
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);var temp=target+"."+Guid.NewGuid().ToString("N")+".tmp";
        try{await File.WriteAllBytesAsync(temp,bytes,ct);if(!OperatingSystem.IsWindows())File.SetUnixFileMode(temp,UnixFileMode.UserRead|UnixFileMode.UserWrite|UnixFileMode.UserExecute);File.Move(temp,target,true);}finally{if(File.Exists(temp))File.Delete(temp);}
        return target;
    }
    private static readonly SemaphoreSlim QueryGate=new(1);
    public static Task<object> RebuildHistoryAsync(string directory,int limit,bool retryFailed,CancellationToken ct=default)
    {
        if(limit is <1 or >400)throw new ArgumentOutOfRangeException(nameof(limit));
        return ExecuteAsync(directory,"history.mjs",JsonSerializer.Serialize(new {limit,retryFailed}),ct);
    }
    public static Task<object> RunAsync(string directory,CancellationToken ct=default)=>ExecuteAsync(directory,"import.mjs",null,ct);
    public static async Task<object> QueryAsync(string directory,string path,CancellationToken ct=default)
    {
        if(Encoding.UTF8.GetByteCount(path)>65536||!(path.StartsWith("/api/analysis/qqq/local-analysis?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/local-archive?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/pcs/backtest?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/pcs?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/gex/intraday-context?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/gex/exposure?",StringComparison.Ordinal)||(path=="/api/analysis/qqq/pcs/local-decision"||path.StartsWith("/api/analysis/qqq/pcs/local-decision?",StringComparison.Ordinal))))throw new ArgumentException("Unsupported local query");
        await QueryGate.WaitAsync(ct);try{return await ExecuteAsync(directory,"query.mjs",path,ct);}finally{QueryGate.Release();}
    }
    private static async Task<object> ExecuteAsync(string directory,string script,string? query,CancellationToken ct)
    {
        using var asset=typeof(QqqGexCalculationRunner).Assembly.GetManifestResourceStream("QqqGexRuntime/"+script);
        if(asset is null)return new {status="runtime_unavailable",complete=false,reason="Bundled GEX calculation resource is missing"};
        using var memory=new MemoryStream();await asset.CopyToAsync(memory,ct);var bytes=memory.ToArray();var hash=Convert.ToHexString(SHA256.HashData(bytes));
        var runtime=Path.Combine(directory,"cache","qqq-runtime",hash+".mjs");Directory.CreateDirectory(Path.GetDirectoryName(runtime)!);
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
