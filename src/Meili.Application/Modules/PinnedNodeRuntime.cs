using System.Formats.Tar;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
namespace Meili.Automation.Modules;

/// <summary>Shared hash-pinned bundled Node runtime. Never resolves system PATH or downloads code.</summary>
internal static class PinnedNodeRuntime
{
    internal static string BundledArchivePath(string baseDirectory,string archiveName)
    {
        var root=Path.TrimEndingDirectorySeparator(baseDirectory);return Path.GetFileName(root)=="MacOS"&&Path.GetFileName(Path.GetDirectoryName(root))=="Contents"?Path.GetFullPath(Path.Combine(root,"..","Resources","runtime",archiveName)):Path.Combine(root,"runtime",archiveName);
    }
    internal static async Task<string?> ExtractNodeAsync(string directory,CancellationToken ct)
    {
        using var manifest=typeof(PinnedNodeRuntime).Assembly.GetManifestResourceStream("QqqGexRuntime/node-lock.json")!;
        using var doc=await JsonDocument.ParseAsync(manifest,cancellationToken:ct);
        var rid=(OperatingSystem.IsWindows()?"win":OperatingSystem.IsMacOS()?"osx":"linux")+"-"+RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant();
        if(!doc.RootElement.GetProperty("platforms").TryGetProperty(rid,out var entry))return null;
        var name=entry.GetProperty("archive").GetString()!;var archive=BundledArchivePath(AppContext.BaseDirectory,name);
        if(!File.Exists(archive))return null;
        await using var file=File.OpenRead(archive);var archiveHash=Convert.ToHexString(await SHA256.HashDataAsync(file,ct));
        if(!archiveHash.Equals(entry.GetProperty("archiveSha256").GetString(),StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Bundled Node archive checksum mismatch");file.Position=0;
        var binaryHash=entry.GetProperty("executableSha256").GetString()!;
        var registry=new ModuleRegistry(directory);registry.CheckRoot();
        var targetFolder=registry.Root;
        foreach(var part in new[]{"runtimes","node24",binaryHash})
        {
            ModulePackage.ValidatePath(part);targetFolder=Path.Combine(targetFolder,part);
            if(Directory.Exists(targetFolder)&&new DirectoryInfo(targetFolder).LinkTarget is not null)throw new InvalidDataException("Linked runtime directory.");
        }
        var target=Path.Combine(targetFolder,OperatingSystem.IsWindows()?"node.exe":"node");
        if(File.Exists(target)&&new FileInfo(target).LinkTarget is not null)throw new InvalidDataException("Linked runtime executable.");
        if(File.Exists(target)){await using var existing=File.OpenRead(target);if(!Convert.ToHexString(await SHA256.HashDataAsync(existing,ct)).Equals(binaryHash,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Extracted Node checksum mismatch");return target;}
        var prefix=name.EndsWith(".zip",StringComparison.Ordinal)?name[..^4]:name[..^7];var member=prefix+(OperatingSystem.IsWindows()?"/node.exe":"/bin/node");using var data=new MemoryStream();
        if(name.EndsWith(".zip",StringComparison.Ordinal)){using var zip=new ZipArchive(file,ZipArchiveMode.Read,true);using var input=zip.GetEntry(member)?.Open()??throw new InvalidDataException("Node executable missing");await input.CopyToAsync(data,ct);}
        else {using var gzip=new GZipStream(file,CompressionMode.Decompress,true);using var tar=new TarReader(gzip,true);TarEntry? part;var found=false;while((part=await tar.GetNextEntryAsync(cancellationToken:ct)) is not null){if(part.Name!=member)continue;if(part.EntryType is not (TarEntryType.RegularFile or TarEntryType.V7RegularFile))throw new InvalidDataException("Node executable is not a file");await part.DataStream!.CopyToAsync(data,ct);found=true;break;}if(!found)throw new InvalidDataException("Node executable missing");}
        var bytes=data.ToArray();if(!Convert.ToHexString(SHA256.HashData(bytes)).Equals(binaryHash,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Node executable checksum mismatch");
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);var temp=target+"."+Guid.NewGuid().ToString("N")+".tmp";
        try{await File.WriteAllBytesAsync(temp,bytes,ct);if(!OperatingSystem.IsWindows())File.SetUnixFileMode(temp,UnixFileMode.UserRead|UnixFileMode.UserWrite|UnixFileMode.UserExecute);File.Move(temp,target,true);}finally{if(File.Exists(temp))File.Delete(temp);}
        return target;
    }
}
