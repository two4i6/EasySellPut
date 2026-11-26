using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Meili.Core.Settings;
namespace Meili.Automation.Modules;

/// <summary>One request's bounded atomic logical input publication. No caller-selected path or partial publication.</summary>
internal sealed class ModuleInputWriter(string directory,string appId,bool allowWrites) : IDisposable
{
    private MemoryStream? staged;
    private SnapshotFile? snapshot;
    private string? expectedHash;
    private int expectedBytes;
    private bool finished;
    private const int Maximum=128*1024*1024;
    internal JsonElement Write(JsonElement arguments)
    {
        if(!allowWrites)throw new UnauthorizedAccessException("Application operation is read-only.");
        if(finished)throw new InvalidOperationException("Input publication has finished.");
        ModuleRegistry.ValidateId(appId);
        var offset=arguments.GetProperty("offset").GetInt32();var total=arguments.GetProperty("totalBytes").GetInt32();var sha256=arguments.GetProperty("sha256").GetString()!;
        if(total is <1 or >Maximum||sha256.Length!=64||sha256.Any(c=>!char.IsAsciiHexDigit(c)))throw new ArgumentException("Invalid input publication metadata.");
        var bytes=Convert.FromBase64String(arguments.GetProperty("bodyBase64").GetString()!);
        if(bytes.Length is <1 or >1048576)throw new ArgumentException("Invalid input chunk size.");
        if(staged is null)
        {
            if(offset!=0)throw new ArgumentException("Input publication must start at zero.");
            var path=ModuleState.ResolvePath(directory,appId,"input");
            snapshot=new SnapshotFile(path,Maximum);staged=new MemoryStream();expectedHash=sha256;expectedBytes=total;
        }
        if(offset!=staged.Length||total!=expectedBytes||!sha256.Equals(expectedHash,StringComparison.OrdinalIgnoreCase)||staged.Length+bytes.Length>total)throw new ArgumentException("Input publication sequence changed.");
        staged.Write(bytes);
        var final=arguments.GetProperty("final").GetBoolean();
        if(!final)return WireJson.Element(WireJson.Success(new{committed=false,nextOffset=staged.Length}));
        if(staged.Length!=total||!Convert.ToHexString(SHA256.HashData(staged.GetBuffer().AsSpan(0,total))).Equals(expectedHash,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Input publication hash mismatch.");
        var text=new UTF8Encoding(false,true).GetString(staged.GetBuffer(),0,total);
        using var document=JsonDocument.Parse(text,new JsonDocumentOptions{MaxDepth=64});
        _=ModuleState.ResolvePath(directory,appId,"input");
        snapshot!.Write(text);finished=true;staged.Dispose();staged=null;
        return WireJson.Element(WireJson.Success(new{committed=true,bytes=total,sha256=expectedHash}));
    }
    public void Dispose(){finished=true;staged?.Dispose();staged=null;snapshot=null;}
}
