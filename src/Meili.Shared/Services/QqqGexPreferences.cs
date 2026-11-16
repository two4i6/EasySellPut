using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Meili.Core.Settings;
namespace Meili.Shared.Services;
/// <summary>Presentation-only preferences, shared across random loopback origins; no credentials or paths.</summary>
public sealed class QqqGexPreferences(string directory)
{
    public sealed record State(string revision,Dictionary<string,string> values);
    private readonly string path=Path.Combine(directory,"qqq-gex-view.json");
    private static string Hash(string text)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    private static bool Allowed(string key)=>key.Length<=200&&new[]{"qqq-gex:","qqq-pcs:","qqq-terminal:","qqq-local:"}.Any(prefix=>key.StartsWith(prefix,StringComparison.Ordinal))&&!new[]{"token","password","secret","api-key","api_key","credential","auth"}.Any(word=>key.Contains(word,StringComparison.OrdinalIgnoreCase));
    private (SnapshotFile File,string? Body,Dictionary<string,string> Values) Open()
    {
        if(File.Exists(path)&&new FileInfo(path).Length>65536)throw new InvalidDataException("GEX preferences exceed the local view limit");
        var file=new SnapshotFile(path);var body=file.Read();var values=body is null?new Dictionary<string,string>():JsonSerializer.Deserialize<Dictionary<string,string>>(body)??throw new InvalidDataException("Invalid GEX preferences");return(file,body,values);
    }
    public State Read(){var value=Open();return new(Hash(value.Body??""),value.Values.Where(p=>Allowed(p.Key)).ToDictionary(p=>p.Key,p=>p.Value));}
    public State Patch(string revision,Dictionary<string,string?> changes)
    {
        if(changes.Count>128||changes.Any(p=>!Allowed(p.Key)||p.Value is not null&&Encoding.UTF8.GetByteCount(p.Value)>8192))throw new ArgumentException("Unsupported or oversized view preference");
        var current=Open();if(!Hash(current.Body??"").Equals(revision,StringComparison.Ordinal))throw new DataConflictException(path);
        foreach(var (key,value) in changes)if(value is null)current.Values.Remove(key);else current.Values[key]=value;
        if(current.Values.Count>128)throw new ArgumentException("Too many view preferences");var body=JsonSerializer.Serialize(current.Values);if(Encoding.UTF8.GetByteCount(body)>65536)throw new ArgumentException("View preferences exceed byte limit");current.File.Write(body);return new(Hash(body),current.Values.Where(p=>Allowed(p.Key)).ToDictionary(p=>p.Key,p=>p.Value));
    }
}
