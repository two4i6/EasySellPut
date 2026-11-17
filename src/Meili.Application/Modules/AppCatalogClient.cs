using System.Net;
using System.Text;
using System.Text.Json;
using Meili.Core.Settings;

namespace Meili.Automation.Modules;

public sealed record AppCatalogEntry(string Id,string Version,int HostApi,int EngineProtocol,int DataFormat,string[] Platforms,long Size,string Sha256,bool HasUi,bool Withdrawn=false);
public sealed record AppCatalog(int SchemaVersion,string Repository,long Sequence,DateTimeOffset IssuedAt,DateTimeOffset ExpiresAt,AppCatalogEntry[] Apps);
public sealed record AppCatalogCheck(string Status,AppCatalog? Catalog=null,string? SignedCatalog=null,string? Signature=null);

/// <summary>Separate signed application channel; never consults or changes the host's Latest release.</summary>
public sealed class AppCatalogClient(HttpClient http,string directory)
{
    public const string CatalogName="EasySellPut-apps.json";
    internal string VerificationKey {get;init;}=UpdateClient.PublicKey;
    internal string Repository {get;init;}=UpdateClient.Repository;
    internal string RuntimeId {get;init;}=UpdateClient.RuntimeId;
    internal TimeProvider Clock {get;init;}=TimeProvider.System;
    private UpdateClient Transport=>new(http,RuntimeId,UpdateClient.CurrentVersion);
    private SnapshotFile SequenceFile=>new(Path.Combine(directory,"apps","catalog-sequence.json"));
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,MaxDepth=16};
    public async Task<AppCatalogCheck> CheckAsync(CancellationToken ct=default)
    {
        if(!UpdateClient.IsValidRepository(Repository))return new("not_configured");
        using var response=await Transport.GetAsync(new Uri($"https://api.github.com/repos/{Repository}/releases/tags/apps"),ct).ConfigureAwait(false);
        if(response.StatusCode==HttpStatusCode.NotFound)return new("no_catalog");
        response.EnsureSuccessStatusCode();
        using var release=JsonDocument.Parse(await UpdateClient.ReadBoundedAsync(response.Content,2*1024*1024,ct).ConfigureAwait(false));
        var root=release.RootElement;
        if(root.GetProperty("draft").GetBoolean()||root.GetProperty("tag_name").GetString()!="apps")throw new InvalidDataException("Unexpected application catalog release.");
        var names=root.GetProperty("assets").EnumerateArray().Select(a=>a.GetProperty("name").GetString()).ToArray();
        foreach(var name in new[]{CatalogName,CatalogName+".sig"})
            if(names.Count(n=>n==name)!=1)throw new InvalidDataException("Missing or duplicate app catalog asset.");
        async Task<byte[]> Asset(string name,int limit)
        {
            // Generated fixed repository URLs, never server-controlled download locations.
            using var asset=await Transport.GetAsync(new Uri($"https://github.com/{Repository}/releases/download/apps/{name}"),ct).ConfigureAwait(false);
            asset.EnsureSuccessStatusCode();return await UpdateClient.ReadBoundedAsync(asset.Content,limit,ct).ConfigureAwait(false);
        }
        var body=await Asset(CatalogName,262144).ConfigureAwait(false);var signature=await Asset(CatalogName+".sig",1024).ConfigureAwait(false);
        var catalog=Verify(body,signature);AdvanceSequence(catalog.Sequence, body);
        return new("available",catalog,Convert.ToBase64String(body),Convert.ToBase64String(signature));
    }
    internal AppCatalog Verify(byte[] body,byte[] signature)
    {
        if(body.Length>262144||signature.Length>1024)throw new InvalidDataException("App catalog exceeds bounds.");
        UpdateClient.VerifyManifest(body,signature,VerificationKey);
        using(var document=JsonDocument.Parse(body,new JsonDocumentOptions{MaxDepth=16}))ModulePackage.RejectDuplicates(document.RootElement);
        var catalog=JsonSerializer.Deserialize<AppCatalog>(body,Json)??throw new InvalidDataException("Missing app catalog.");
        var now=Clock.GetUtcNow();
        if(catalog.SchemaVersion!=1||!UpdateClient.IsValidRepository(Repository)||catalog.Repository!=Repository||catalog.Sequence<1||
            catalog.IssuedAt>now.AddMinutes(5)||catalog.ExpiresAt<=now||catalog.ExpiresAt<=catalog.IssuedAt||catalog.ExpiresAt-catalog.IssuedAt>TimeSpan.FromDays(30)||
            catalog.Apps is null||catalog.Apps.Length>64||catalog.Apps.Select(a=>a?.Id).Distinct(StringComparer.Ordinal).Count()!=catalog.Apps.Length)
            throw new InvalidDataException("Invalid, expired or foreign application catalog.");
        foreach(var entry in catalog.Apps)
        {
            if(entry is null)throw new InvalidDataException("Null app catalog entry.");ModuleRegistry.ValidateId(entry.Id);
            if(!Version.TryParse(entry.Version,out var version)||version.Build<0||version.Revision!=-1||version.ToString(3)!=entry.Version||entry.HostApi<1||entry.EngineProtocol<1||
                entry.DataFormat<1||entry.Platforms is null||entry.Platforms.Length is <1 or >16||entry.Platforms.Distinct(StringComparer.Ordinal).Count()!=entry.Platforms.Length||
                entry.Size<=0||entry.Size>ModulePackage.MaxBytes||entry.Sha256 is null||entry.Sha256.Length!=64||entry.Sha256.Any(c=>!char.IsAsciiHexDigit(c)))
                throw new InvalidDataException("Incompatible app catalog entry.");
        }
        return catalog;
    }
    private void AdvanceSequence(long sequence, byte[] body)
    {
        new ModuleRegistry(directory).CheckRoot();
        var sequencePath=Path.Combine(directory,"apps","catalog-sequence.json");
        if(File.Exists(sequencePath)&&(new FileInfo(sequencePath).Length>1024||new FileInfo(sequencePath).LinkTarget is not null))throw new InvalidDataException("Unsafe app catalog sequence state.");
        var hash=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(body));
        var file=SequenceFile;var current=file.Read();
        if(current is not null)
        {
            if(current.Length>1024)throw new InvalidDataException("Invalid app catalog sequence state.");
            using var state=JsonDocument.Parse(current);
            var legacy=state.RootElement.ValueKind==JsonValueKind.Number;
            var highest=legacy?state.RootElement.GetInt64():state.RootElement.GetProperty("sequence").GetInt64();
            if(sequence<highest)throw new InvalidDataException("Application catalog rollback rejected.");
            if(sequence==highest&&!legacy)
            {
                if(state.RootElement.GetProperty("sha256").GetString()!=hash)throw new InvalidDataException("Conflicting app catalogs have the same generation.");
                return;
            }
        }
        file.Write(JsonSerializer.Serialize(new{sequence,sha256=hash}));
    }
    public async Task<string> DownloadAsync(AppCatalogCheck check,string id,string folder,IProgress<double>? progress=null,CancellationToken ct=default)
    {
        ModuleRegistry.ValidateId(id);
        if(check.Status!="available"||check.SignedCatalog is null||check.Signature is null||check.SignedCatalog.Length>350000||check.Signature.Length>2048)
            throw new InvalidDataException("No authenticated app catalog.");
        // Public DTOs are not execution authority. Authenticate the original immutable bytes again.
        var body=Convert.FromBase64String(check.SignedCatalog);
        var catalog=Verify(body,Convert.FromBase64String(check.Signature));AdvanceSequence(catalog.Sequence,body);
        var app=catalog.Apps.SingleOrDefault(a=>a.Id==id&&!a.Withdrawn&&a.HostApi==ModulePackage.HostApi&&a.EngineProtocol==ModulePackage.EngineProtocol&&a.Platforms.Contains(RuntimeId,StringComparer.Ordinal))
            ??throw new InvalidDataException("Application is withdrawn or unavailable on this platform.");
        var installed=new ModuleRegistry(directory).Read().State.Apps.SingleOrDefault(a=>a.Id==id);
        if(installed is not null&&(Version.Parse(app.Version)<Version.Parse(installed.Version)||app.DataFormat!=installed.DataFormat))
            throw new InvalidDataException("App downgrade or data migration rejected.");
        var name=app.Id+"-"+app.Version+".espapp";
        var uri=new Uri($"https://github.com/{Repository}/releases/download/{app.Id}-v{app.Version}/{name}");
        var path=await Transport.DownloadVerifiedAsync(uri,name,app.Size,app.Sha256,folder,progress,ct).ConfigureAwait(false);
        try
        {
            var package=await ModulePackage.VerifyAsync(path,VerificationKey,Repository,RuntimeId,ct).ConfigureAwait(false);
            if(package.Manifest.Id!=app.Id||package.Manifest.Version!=app.Version||package.Manifest.DataFormat!=app.DataFormat||
                (package.Manifest.Ui is not null)!=app.HasUi)throw new InvalidDataException("App package differs from signed catalog.");
            return path;
        }
        catch{File.Delete(path);throw;}
    }
}
