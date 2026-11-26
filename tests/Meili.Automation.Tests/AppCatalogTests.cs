using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Meili.Automation.Modules;
namespace Meili.Automation.Tests;
public sealed class AppCatalogTests : IDisposable
{
    private readonly string root=Path.Combine(Path.GetTempPath(),"app-feed-"+Guid.NewGuid().ToString("N"));
    private readonly ECDsa key=ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private readonly List<string> requests=[];
    private sealed class Handler(Func<HttpRequestMessage,HttpResponseMessage> respond):HttpMessageHandler
    {protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct){ct.ThrowIfCancellationRequested();return Task.FromResult(respond(request));}}
    private byte[] Package()
    {
        var script=Encoding.UTF8.GetBytes("process.stdout.write('{}');");
        var manifest=new ModuleManifest(1,"test/source","easysellput.test","1.0.0",1,1,1,"node24","engine/main.mjs",null,["linux-x64"],[new("engine/main.mjs",script.Length,Convert.ToHexString(SHA256.HashData(script)))]);
        var body=JsonSerializer.SerializeToUtf8Bytes(manifest,Json);using var memory=new MemoryStream();
        using(var zip=new ZipArchive(memory,ZipArchiveMode.Create,true)){
            void Add(string name,byte[] data){using var output=zip.CreateEntry(name).Open();output.Write(data);}
            Add("app.json",body);Add("app.sig",key.SignData(body,HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence));Add("engine/main.mjs",script);
        }
        return memory.ToArray();
    }
    private AppCatalogClient Client(AppCatalog catalog,byte[]? package=null,bool tamper=false)
    {
        var body=JsonSerializer.SerializeToUtf8Bytes(catalog,Json);var signature=key.SignData(body,HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence);
        if(tamper)body[^2]^=1;
        var release=JsonSerializer.SerializeToUtf8Bytes(new{draft=false,prerelease=true,tag_name="apps",assets=new[]{new{name=AppCatalogClient.CatalogName,browser_download_url="https://evil.invalid/ignored"},new{name=AppCatalogClient.CatalogName+".sig",browser_download_url="https://evil.invalid/ignored"}}});
        var handler=new Handler(request=>{
            var uri=request.RequestUri!;requests.Add(uri.AbsoluteUri);
            return new(HttpStatusCode.OK){Content=new ByteArrayContent(uri.Host=="api.github.com"?release:uri.AbsolutePath.EndsWith(".sig")?signature:uri.AbsolutePath.EndsWith(".json")?body:package??[]) };
        });
        return new(new HttpClient(handler),root){VerificationKey=key.ExportSubjectPublicKeyInfoPem(),Repository="test/source",RuntimeId="linux-x64"};
    }
    private AppCatalog Catalog(byte[] package,long sequence=10,bool withdrawn=false)=>new(1,"test/source",sequence,DateTimeOffset.UtcNow.AddMinutes(-1),DateTimeOffset.UtcNow.AddDays(7),
        [new("easysellput.test","1.0.0",1,1,1,["linux-x64"],package.Length,Convert.ToHexString(SHA256.HashData(package)),false,withdrawn)]);
    [Fact] public async Task Separate_signed_channel_downloads_exact_package_without_host_Latest_or_automatic_install()
    {
        var package=Package();var client=Client(Catalog(package),package);var check=await client.CheckAsync();
        var path=await client.DownloadAsync(check,"easysellput.test",Path.Combine(root,"downloads"));
        Assert.Equal(package,await File.ReadAllBytesAsync(path));Assert.Empty(new ModuleRegistry(root).Read().State.Apps);
        Assert.Contains(requests,r=>r.EndsWith("/releases/tags/apps"));Assert.DoesNotContain(requests,r=>r.Contains("/latest")||r.Contains("evil.invalid"));
    }
    [Fact] public async Task Invalid_signature_wrong_source_and_expired_catalog_do_not_create_profile()
    {
        var package=Package();var catalog=Catalog(package);
        await Assert.ThrowsAsync<InvalidDataException>(()=>Client(catalog,package,tamper:true).CheckAsync());
        await Assert.ThrowsAsync<InvalidDataException>(()=>Client(catalog with{Repository="foreign/source"},package).CheckAsync());
        await Assert.ThrowsAsync<InvalidDataException>(()=>Client(catalog with{IssuedAt=DateTimeOffset.UtcNow.AddDays(-2),ExpiresAt=DateTimeOffset.UtcNow.AddDays(-1)},package).CheckAsync());
        Assert.False(Directory.Exists(root));
    }
    [Fact] public async Task Rollback_withdrawal_and_tampered_public_DTO_cannot_authorize_download()
    {
        var package=Package();await Client(Catalog(package,20),package).CheckAsync();
        await Assert.ThrowsAsync<InvalidDataException>(()=>Client(Catalog(package,19),package).CheckAsync());
        await Assert.ThrowsAsync<InvalidDataException>(()=>Client(Catalog(package,20) with{ExpiresAt=DateTimeOffset.UtcNow.AddDays(8)},package).CheckAsync());
        var withdrawn=Client(Catalog(package,21,withdrawn:true),package);var check=await withdrawn.CheckAsync();
        // Changing the convenient parsed DTO never changes signed authority.
        check.Catalog!.Apps[0]=check.Catalog.Apps[0] with{Withdrawn=false};
        await Assert.ThrowsAsync<InvalidDataException>(()=>withdrawn.DownloadAsync(check,"easysellput.test",Path.Combine(root,"downloads")));
        Assert.DoesNotContain(requests,r=>r.EndsWith(".espapp"));
    }
    public void Dispose(){key.Dispose();if(Directory.Exists(root))Directory.Delete(root,true);}
}
