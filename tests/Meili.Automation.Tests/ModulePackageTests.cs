using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Meili.Automation.Modules;

namespace Meili.Automation.Tests;

public sealed class ModulePackageTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "esp-modules-" + Guid.NewGuid().ToString("N"));
    private readonly ECDsa key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private string Package(string path = "engine/main.mjs", bool tamper = false, string repository = "test/source", int api = 1, bool extra = false, string version = "1.0.0", ModuleOperation[]? operations = null, string scriptText = "export const value=1;", bool ui = false, string id = "easysellput.test", Dictionary<string,string>? companions = null, int dataFormat = 1)
    {
        Directory.CreateDirectory(root);
        var filename = Path.Combine(root, Guid.NewGuid().ToString("N") + ".espapp");
        var script = Encoding.UTF8.GetBytes(scriptText);
        var html = Encoding.UTF8.GetBytes("<!doctype html><title>Fixture app</title><p>Signed fixture application</p>");
        var metadata = operations is null ? null : JsonSerializer.SerializeToUtf8Bytes(operations, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var files = new List<ModuleFile> { new(path, script.Length, Convert.ToHexString(SHA256.HashData(script))) };
        foreach(var pair in companions??[]) {var data=Encoding.UTF8.GetBytes(pair.Value);files.Add(new(pair.Key,data.Length,Convert.ToHexString(SHA256.HashData(data))));}
        if (metadata is not null) files.Add(new("operations.json", metadata.Length, Convert.ToHexString(SHA256.HashData(metadata))));
        if (ui) files.Add(new("ui/index.html", html.Length, Convert.ToHexString(SHA256.HashData(html))));
        var manifest = new ModuleManifest(1, repository, id, version, api, 1, dataFormat, "node24", path, ui ? "ui/index.html" : null,
            ["linux-x64"], files.ToArray());
        var bytes = JsonSerializer.SerializeToUtf8Bytes(manifest, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var zip = ZipFile.Open(filename, ZipArchiveMode.Create);
        void Add(string name, byte[] data) { using var stream = zip.CreateEntry(name).Open(); stream.Write(data); }
        foreach(var pair in companions??[])Add(pair.Key,Encoding.UTF8.GetBytes(pair.Value));
        if (ui) Add("ui/index.html",html);
        if (metadata is not null) Add("operations.json", metadata);
        Add("app.json", bytes);
        Add("app.sig", key.SignData(bytes, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence));
        Add(path, tamper ? Encoding.UTF8.GetBytes("export const value=2;") : script);
        if (extra) Add("unlisted.mjs", script);
        return filename;
    }
    private Task<VerifiedModule> Verify(string file, string? publicKey = null) => ModulePackage.VerifyAsync(file,
        publicKey ?? key.ExportSubjectPublicKeyInfoPem(), "test/source", "linux-x64", CancellationToken.None);

    private sealed class ViewDispatcher(string directory,ModuleInstaller installer) : IOperationDispatcher
    {
        public Meili.Core.Settings.DataDirectoryInfo DirectoryInfo=>new(directory,Meili.Core.Settings.DataDirectorySource.CommandLine);
        public async Task<IOperationCatalog> GetCatalogAsync(CancellationToken ct=default)=>ModuleOperations.Merge(await ModuleOperations.ReadAsync(directory,installer,ct));
        public async Task<JsonElement> ExecuteAsync(string name,JsonElement arguments,bool writes,CancellationToken ct=default)
        {
            var bound=(await ModuleOperations.ReadAsync(directory,installer,ct)).Single(o=>o.Definition.Name==name);
            return WireJson.Element(WireJson.Success(await ModuleProcess.ExecuteAsync(directory,bound,arguments,writes,installer,_=>Task.FromResult<string?>("node"),ct)));
        }
        public void Dispose(){}
    }
    [Fact]
    public async Task Private_signed_UI_is_token_origin_and_app_scoped_with_same_headless_handler()
    {
        var profile=Path.Combine(root,"private-view");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        var schema=JsonSerializer.SerializeToElement(new{type="object",properties=new{},required=Array.Empty<string>(),additionalProperties=false});
        var read=new ModuleOperation("app_easysellput_test_summary","Evidence",false,schema,"engine/main.mjs");
        await installer.InstallAsync(Package(ui:true,operations:[read,read with{Name="app_easysellput_test_record",Writes=true}],scriptText:"process.stdout.write(JSON.stringify({fixture:true,source:'retained'}));"));
        using var dispatcher=new ViewDispatcher(profile,installer);using var http=new HttpClient();
        var session=await PrivateAppSession.CreateAsync(profile,"easysellput.test",dispatcher,false,installer,CancellationToken.None);
        try
        {
            var page=await http.GetAsync(session.PageUri);Assert.True(page.IsSuccessStatusCode);
            Assert.Contains("Signed fixture application",await page.Content.ReadAsStringAsync());
            Assert.Contains("connect-src 'self'",page.Headers.GetValues("Content-Security-Policy").Single());
            Assert.Equal(System.Net.HttpStatusCode.Forbidden,(await http.GetAsync(new Uri(session.PageUri,"/index.html"))).StatusCode);
            using(var foreign=new HttpRequestMessage(HttpMethod.Get,session.PageUri)){foreign.Headers.Add("Origin","https://foreign.invalid");Assert.Equal(System.Net.HttpStatusCode.Forbidden,(await http.SendAsync(foreign)).StatusCode);}
            var catalog=await http.GetStringAsync(new Uri(session.PageUri,"host/catalog"));Assert.Contains(read.Name,catalog);Assert.DoesNotContain("app_easysellput_test_record",catalog);
            async Task<HttpResponseMessage> Invoke(string operation,object arguments)
            {
                var message=new HttpRequestMessage(HttpMethod.Post,new Uri(session.PageUri,"host/invoke"));message.Headers.Add("Origin",session.PageUri.GetLeftPart(UriPartial.Authority));
                message.Content=new StringContent(JsonSerializer.Serialize(new{operation,arguments}),Encoding.UTF8,"application/json");return await http.SendAsync(message);
            }
            using(var response=await Invoke(read.Name,new{})){Assert.True(response.IsSuccessStatusCode);using var doc=JsonDocument.Parse(await response.Content.ReadAsStringAsync());Assert.Equal("retained",doc.RootElement.GetProperty("data").GetProperty("source").GetString());}
            using(var denied=await Invoke("app_easysellput_test_record",new{}))Assert.Equal(System.Net.HttpStatusCode.Forbidden,denied.StatusCode);
            using(var invalid=await Invoke(read.Name,new{unexpected=true}))Assert.Equal(System.Net.HttpStatusCode.BadRequest,invalid.StatusCode);
            using(var duplicate=new HttpRequestMessage(HttpMethod.Post,new Uri(session.PageUri,"host/invoke")))
            {
                duplicate.Headers.Add("Origin",session.PageUri.GetLeftPart(UriPartial.Authority));
                duplicate.Content=new StringContent("{\"operation\":\""+read.Name+"\",\"operation\":\"foreign\",\"arguments\":{}}",Encoding.UTF8,"application/json");
                Assert.Equal(System.Net.HttpStatusCode.BadRequest,(await http.SendAsync(duplicate)).StatusCode);
            }
            session.UpdatePresentation(JsonSerializer.SerializeToElement(new{language="en-US",theme=new{dark=false,reducedMotion=true,background="#FAF9F5"}}));
            var presentationUrl=new Uri(session.PageUri,"host/presentation");
            using(var first=JsonDocument.Parse(await http.GetStringAsync(presentationUrl)))
            {
                var version=first.RootElement.GetProperty("version").GetInt64();
                var next=http.GetStringAsync(new Uri(presentationUrl+"?version="+version));
                session.UpdatePresentation(JsonSerializer.SerializeToElement(new{language="zh-CN",theme=new{dark=true,reducedMotion=false,background="#262624"}}));
                using var changed=JsonDocument.Parse(await next.WaitAsync(TimeSpan.FromSeconds(3)));
                Assert.True(changed.RootElement.GetProperty("version").GetInt64()>version);Assert.Equal("zh-CN",changed.RootElement.GetProperty("value").GetProperty("language").GetString());
            }
            Assert.Throws<IOException>(()=>installer.Uninstall("easysellput.test"));
        }
        finally{await session.DisposeAsync();}
        installer.Uninstall("easysellput.test");
    }

    [Fact]
    public async Task Optional_UI_attaches_to_identical_core_without_rebuilding_or_overwriting_it()
    {
        var profile=Path.Combine(root,"attach");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        var schema=JsonSerializer.SerializeToElement(new{type="object",properties=new{},required=Array.Empty<string>(),additionalProperties=false});
        var operation=new ModuleOperation("app_easysellput_test_summary","Evidence",false,schema,"engine/main.mjs");
        const string script="process.stdout.write(JSON.stringify({source:'unchanged-core'}));";
        await installer.InstallAsync(Package(operations:[operation],scriptText:script));
        var original=installer.Inspect().State.Apps.Single();var originalArchive=installer.InstalledArchive(original);
        var originalBytes=await File.ReadAllBytesAsync(originalArchive);
        var oldOperation=(await ModuleOperations.ReadAsync(profile,installer,CancellationToken.None)).Single();
        await Assert.ThrowsAsync<InvalidDataException>(()=>installer.InstallAsync(Package(ui:true,operations:[operation],scriptText:"process.stdout.write('{}');")));
        Assert.Equal(original,installer.Inspect().State.Apps.Single());
        await installer.InstallAsync(Package(ui:true,operations:[operation],scriptText:script));
        Assert.True(installer.Inspect().State.Apps.Single().HasUi);
        Assert.Equal(originalBytes,await File.ReadAllBytesAsync(originalArchive));
        Assert.NotEqual(originalArchive,installer.InstalledArchive(installer.Inspect().State.Apps.Single()));
        await Assert.ThrowsAsync<InvalidOperationException>(()=>ModuleProcess.ExecuteAsync(profile,oldOperation,JsonSerializer.SerializeToElement(new{}),false,installer,_=>Task.FromResult<string?>("node"),CancellationToken.None));
        using var dispatcher=new ViewDispatcher(profile,installer);
        await using(var view=await PrivateAppSession.CreateAsync(profile,original.Id,dispatcher,false,installer,CancellationToken.None))
        {using var http=new HttpClient();Assert.Contains("Signed fixture application",await http.GetStringAsync(view.PageUri));}
        var active=installer.Inspect().State.Apps.Single();
        await Assert.ThrowsAsync<InvalidDataException>(()=>installer.InstallAsync(Package(ui:true,operations:[operation],scriptText:"process.stdout.write('{}');")));
        await Assert.ThrowsAsync<InvalidDataException>(()=>installer.InstallAsync(Package(operations:[operation],scriptText:script)));
        Assert.Equal(active,installer.Inspect().State.Apps.Single());
    }

    [Fact]
    public async Task Existing_unhashed_layout_remains_readable_and_cannot_mask_corrupt_variant()
    {
        var profile=Path.Combine(root,"legacy-layout");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        await installer.InstallAsync(Package());var app=installer.Inspect().State.Apps.Single();
        var variantArchive=installer.InstalledArchive(app);var variant=Path.GetDirectoryName(variantArchive)!;
        var legacyArchive=Path.Combine(Path.GetDirectoryName(variant)!,"package.espapp");
        File.Move(variantArchive,legacyArchive);Directory.Delete(variant);
        Assert.Equal(app.PackageSha256,(await installer.VerifyInstalledAsync(app.Id)).PackageSha256);
        Directory.CreateDirectory(variant);await File.WriteAllBytesAsync(variantArchive,[1,2,3]);
        await Assert.ThrowsAsync<InvalidDataException>(()=>installer.VerifyInstalledAsync(app.Id));
    }

    [Fact]
    public async Task Liquidity_core_preserves_shared_report_and_update_disable_uninstall_boundaries()
    {
        var profile=Path.Combine(root,"liquidity-core");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        var sourceRoot=Path.GetDirectoryName(new Uri(JsonSerializer.Deserialize<string>(HostSdkUri())!).LocalPath)!;
        var appRoot=Path.GetFullPath(Path.Combine(sourceRoot,"..","market-liquidity"));
        var operations=JsonSerializer.Deserialize<ModuleOperation[]>(await File.ReadAllTextAsync(Path.Combine(appRoot,"operations.json")),new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        var operation=Assert.Single(operations);
        Assert.True(JsonElement.DeepEquals(OperationCatalog.Find(operation.Name).Schema,operation.Schema));
        Assert.False(operation.Writes);Assert.Equal(new[]{"get_market_liquidity"},operation.HostOperations);
        var script=(await File.ReadAllTextAsync(Path.Combine(appRoot,"runtime","report.mjs"))).Replace("'../../app-sdk/engine-host.mjs'",HostSdkUri());
        using var service=new AutomationService(new(profile,Meili.Core.Settings.DataDirectorySource.CommandLine),new FakeMarket(),liquiditySource:new Meili.Testing.LiquidityFixture(),liquidityClock:Meili.Testing.LiquidityFixture.Clock);
        var arguments=JsonSerializer.SerializeToElement(new{});
        var native=new Meili.Shared.Services.LiquidityAppClient(profile,new Meili.Shared.Services.MarketLiquidityService(new Meili.Testing.LiquidityFixture(),new FakeMarket(),Meili.Testing.LiquidityFixture.Clock),installer,_=>Task.FromResult<string?>("node"));
        Assert.Equal(49.8,(await native.LoadAsync()).PressureIndex.Score); // Compatibility before first install.
        JsonElement original=default;
        async Task<JsonElement> SharedHost(string name,JsonElement args,CancellationToken ct)
        {
            original=await service.ExecuteHostOperationAsync(name,args,ct);
            return original;
        }
        foreach(var version in new[]{"1.0.0","1.0.1"})
        {
            await installer.InstallAsync(Package(path:"engine/report.mjs",id:ModuleAccess.MarketLiquidity,version:version,operations:operations,scriptText:script));
            var bound=Assert.Single(await ModuleOperations.ReadAsync(profile,installer,CancellationToken.None));
            Assert.Equal(version,bound.Version);
            var result=await ModuleProcess.ExecuteAsync(profile,bound,arguments,false,installer,_=>Task.FromResult<string?>("node"),CancellationToken.None,SharedHost);
            Assert.True(JsonElement.DeepEquals(original.GetProperty("data"),result));
            Assert.Equal(6,result.GetProperty("metrics").GetArrayLength());Assert.Equal(11,result.GetProperty("sectors").GetArrayLength());
            Assert.Equal(49.8,result.GetProperty("pressureIndex").GetProperty("score").GetDouble());
            var nativeReport=await native.LoadAsync();Assert.Equal(49.8,nativeReport.PressureIndex.Score);Assert.Equal(6,nativeReport.Metrics.Count);Assert.Equal(11,nativeReport.Sectors.Count);
        }
        await installer.SetEnabledAsync(ModuleAccess.MarketLiquidity,false);
        Assert.Empty(await ModuleOperations.ReadAsync(profile,installer,CancellationToken.None));Assert.False(ModuleAccess.IsEnabled(profile,ModuleAccess.MarketLiquidity));
        await Assert.ThrowsAsync<AppUnavailableException>(()=>native.LoadAsync());
        var disabledCatalog=await service.GetCatalogAsync();Assert.Throws<ArgumentException>(()=>disabledCatalog.Find("get_market_liquidity"));
        await installer.SetEnabledAsync(ModuleAccess.MarketLiquidity,true);
        installer.Uninstall(ModuleAccess.MarketLiquidity);await Assert.ThrowsAsync<AppUnavailableException>(()=>native.LoadAsync());Assert.False(ModuleAccess.IsEnabled(profile,ModuleAccess.MarketLiquidity));
        Assert.Empty(await ModuleOperations.ReadAsync(profile,installer,CancellationToken.None));
        Assert.Throws<InvalidOperationException>(()=>ModuleAccess.AcquireEnabled(profile,ModuleAccess.MarketLiquidity));
        await installer.InstallAsync(Package(path:"engine/report.mjs",id:ModuleAccess.MarketLiquidity,version:"1.0.1",operations:operations,scriptText:script));
        Assert.True(ModuleAccess.IsEnabled(profile,ModuleAccess.MarketLiquidity));
    }

    [Fact]
    public async Task Liquidity_id_cannot_activate_without_its_compatible_report_contract()
    {
        var profile=Path.Combine(root,"missing-liquidity-report");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        await Assert.ThrowsAsync<InvalidDataException>(()=>installer.InstallAsync(Package(id:ModuleAccess.MarketLiquidity)));
        await Assert.ThrowsAsync<InvalidDataException>(()=>installer.InstallAsync(Package(id:ModuleAccess.MarketLiquidity,operations:[])));
        Assert.Empty(installer.Inspect().State.Apps);
    }

    [Theory]
    [InlineData("easysellput.test", "get_market_liquidity", false)]
    [InlineData("easysellput.market-liquidity", "get_quotes", false)]
    [InlineData("easysellput.market-liquidity", "get_market_liquidity", true)]
    public async Task Liquidity_package_cannot_steal_foreign_contracts_or_escalate_permissions(string id,string name,bool writes)
    {
        var profile=Path.Combine(root,Guid.NewGuid().ToString("N"));var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        var op=OperationCatalog.Find(name);
        await Assert.ThrowsAsync<InvalidDataException>(()=>installer.InstallAsync(Package(id:id,operations:[new(name,op.Description,writes,op.Schema,"engine/main.mjs")])));
        Assert.Empty(installer.Inspect().State.Apps);
    }

    private static string HostSdkUri()
    {
        var directory=AppContext.BaseDirectory;
        while(!File.Exists(Path.Combine(directory,"MeiliTerminal.slnx")))directory=Path.GetDirectoryName(directory)??throw new IOException("Missing repository.");
        return JsonSerializer.Serialize(new Uri(Path.Combine(directory,"web","app-sdk","engine-host.mjs")).AbsoluteUri);
    }
    [Fact]
    public async Task Logical_snapshots_are_read_only_app_scoped_and_preserve_atomic_store_errors()
    {
        var profile=Path.Combine(root,"state-calls");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        var schema=JsonSerializer.SerializeToElement(new{type="object",properties=new{},required=Array.Empty<string>(),additionalProperties=false});
        var operation=new ModuleOperation("app_easysellput_test_summary","Saved state",false,schema,"engine/main.mjs",["read_app_snapshot"]);
        var script="import {createHostEngine} from "+HostSdkUri()+";const engine=await createHostEngine();try{const own=await engine.call('read_app_snapshot',{key:'preferences'});let rejected=false;try{await engine.call('read_app_snapshot',{key:'../../settings'});}catch{rejected=true;}engine.finish({own,rejected});}finally{engine.close();}";
        await installer.InstallAsync(Package(operations:[operation],scriptText:script));
        var ownPath=Path.Combine(profile,"apps","data","easysellput.test","state","preferences.json");Directory.CreateDirectory(Path.GetDirectoryName(ownPath)!);
        const string saved="{\"label\":\"中文 / local\"}";await File.WriteAllTextAsync(ownPath,saved);
        await File.WriteAllTextAsync(Path.Combine(profile,"qqq-gex-view.json"),"foreign app state");
        var bound=(await ModuleOperations.ReadAsync(profile,installer,CancellationToken.None)).Single();
        var result=await ModuleProcess.ExecuteAsync(profile,bound,JsonSerializer.SerializeToElement(new{}),false,installer,_=>Task.FromResult<string?>("node"),CancellationToken.None);
        Assert.Equal(saved,result.GetProperty("own").GetProperty("body").GetString());Assert.True(result.GetProperty("rejected").GetBoolean());
        Assert.Equal(saved,await File.ReadAllTextAsync(ownPath));Assert.False(File.Exists(Path.Combine(profile,"settings.json")));
        if(!OperatingSystem.IsWindows())
        {
            var outside=Path.Combine(root,"outside.json");await File.WriteAllTextAsync(outside,"unrelated");File.Delete(ownPath);File.CreateSymbolicLink(ownPath,outside);
            Assert.Throws<InvalidDataException>(()=>ModuleState.Read(profile,"easysellput.test","preferences"));
            using var writer=new ModuleInputWriter(profile,"easysellput.test",true);var inputPath=Path.Combine(Path.GetDirectoryName(ownPath)!,"input.json");File.CreateSymbolicLink(inputPath,outside);
            Assert.Throws<InvalidDataException>(()=>writer.Write(JsonSerializer.SerializeToElement(new{offset=0,totalBytes=2,sha256=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("{}"))),bodyBase64="e30=",final=true})));
            Assert.Equal("unrelated",await File.ReadAllTextAsync(outside));File.Delete(inputPath);File.Delete(ownPath);
        }
        await File.WriteAllTextAsync(ownPath,new string('x',65537));
        Assert.Throws<InvalidDataException>(()=>ModuleState.Read(profile,"easysellput.test","preferences"));
        Assert.Throws<ArgumentException>(()=>ModuleState.Read(profile,"easysellput.test","../settings"));
        var missing=Path.Combine(root,"absent-state");Assert.Null(ModuleState.Read(missing,"other.app","desktop").GetProperty("data").GetProperty("body").GetString());Assert.False(Directory.Exists(missing));
    }

    [Fact]
    public async Task Signed_input_publication_requires_writes_and_atomically_preserves_conflicts_hashes_and_incomplete_uploads()
    {
        var profile=Path.Combine(root,"input-calls");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        var schema=JsonSerializer.SerializeToElement(new{type="object",properties=new{},required=Array.Empty<string>(),additionalProperties=false});
        var operation=new ModuleOperation("app_easysellput_test_record","Record input",true,schema,"engine/main.mjs",["write_app_input"]);
        const string body="{\"value\":\"中文\"}";var bytes=Encoding.UTF8.GetBytes(body);var digest=Convert.ToHexString(SHA256.HashData(bytes));
        var inputPath=Path.Combine(profile,"apps","data","easysellput.test","state","input.json");Directory.CreateDirectory(Path.GetDirectoryName(inputPath)!);await File.WriteAllTextAsync(inputPath,"{\"old\":true}");
        var script="import {createHostEngine} from "+HostSdkUri()+";import{readFileSync}from'node:fs';import{join}from'node:path';const engine=await createHostEngine();try{const bytes=Buffer.from('"+Convert.ToBase64String(bytes)+"','base64'),base={totalBytes:bytes.length,sha256:'"+digest+"'};const first=await engine.call('write_app_input',{...base,offset:0,bodyBase64:bytes.subarray(0,5).toString('base64'),final:false});const before=readFileSync(join(engine.request.context.dataDirectory,'apps/data/easysellput.test/state/input.json'),'utf8');const committed=await engine.call('write_app_input',{...base,offset:5,bodyBase64:bytes.subarray(5).toString('base64'),final:true});engine.finish({first,before,committed});}finally{engine.close();}";
        await installer.InstallAsync(Package(operations:[operation],scriptText:script));
        var bound=(await ModuleOperations.ReadAsync(profile,installer,CancellationToken.None)).Single();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>ModuleProcess.ExecuteAsync(profile,bound,JsonSerializer.SerializeToElement(new{}),false,installer,_=>Task.FromResult<string?>("node"),CancellationToken.None));
        var result=await ModuleProcess.ExecuteAsync(profile,bound,JsonSerializer.SerializeToElement(new{}),true,installer,_=>Task.FromResult<string?>("node"),CancellationToken.None);
        Assert.Equal("{\"old\":true}",result.GetProperty("before").GetString());Assert.False(result.GetProperty("first").GetProperty("committed").GetBoolean());Assert.True(result.GetProperty("committed").GetProperty("committed").GetBoolean());Assert.Equal(body,await File.ReadAllTextAsync(inputPath));
        JsonElement Chunk(int offset,int count,bool final,string? hash=null)=>JsonSerializer.SerializeToElement(new{offset,totalBytes=bytes.Length,sha256=hash??digest,bodyBase64=Convert.ToBase64String(bytes,offset,count),final});
        using(var incomplete=new ModuleInputWriter(profile,"easysellput.test",true))incomplete.Write(Chunk(0,5,false));
        Assert.Equal(body,await File.ReadAllTextAsync(inputPath));
        using(var conflicting=new ModuleInputWriter(profile,"easysellput.test",true))
        {
            conflicting.Write(Chunk(0,5,false));new Meili.Core.Settings.SnapshotFile(inputPath).Write("{\"external\":true}");
            Assert.Throws<Meili.Core.Settings.DataConflictException>(()=>conflicting.Write(Chunk(5,bytes.Length-5,true)));
        }
        Assert.Equal("{\"external\":true}",await File.ReadAllTextAsync(inputPath));
        using(var corrupt=new ModuleInputWriter(profile,"easysellput.test",true))Assert.Throws<InvalidDataException>(()=>corrupt.Write(Chunk(0,bytes.Length,true,new string('0',64))));
        Assert.Equal("{\"external\":true}",await File.ReadAllTextAsync(inputPath));
        await Assert.ThrowsAsync<InvalidDataException>(()=>installer.InstallAsync(Package(id:"other.readonly",operations:[operation with{Name="app_other_readonly_record",Writes=false}])));
    }

    [Fact]
    public async Task Market_source_deadline_releases_the_shared_provider_gate_and_disposal_expires_receipts()
    {
        var profile=Path.Combine(root,"source-deadline");
        var market=new FakeMarket{BarsOverride=async(request,ct)=>{await Task.Delay(Timeout.InfiniteTimeSpan,ct);throw new InvalidOperationException("Unreachable");}};
        using var service=new AutomationService(new(profile,Meili.Core.Settings.DataDirectorySource.CommandLine),market);
        var session=service.BeginModuleHostSession();
        var expired=await session.InvokeAsync("open_market_snapshot",JsonSerializer.SerializeToElement(new{kind="bars",symbol="QQQ",timeoutMs=5}),CancellationToken.None);
        Assert.False(expired.GetProperty("success").GetBoolean());Assert.Equal("cancelled",expired.GetProperty("error").GetProperty("code").GetString());
        var quotes=await service.ExecuteAsync("get_quotes",JsonSerializer.SerializeToElement(new{symbols=new[]{"AAPL"}}),false).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.True(quotes.GetProperty("success").GetBoolean());
        using var cancelled=new CancellationTokenSource();cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>session.InvokeAsync("open_market_snapshot",JsonSerializer.SerializeToElement(new{kind="chain",symbol="QQQ"}),cancelled.Token));
        session.Dispose();await Assert.ThrowsAsync<ObjectDisposedException>(()=>session.InvokeAsync("open_market_snapshot",JsonSerializer.SerializeToElement(new{kind="chain",symbol="QQQ"}),CancellationToken.None));
        Assert.False(Directory.Exists(profile));
    }

    [Fact]
    public async Task Signed_app_reads_exact_request_owned_source_bytes_without_pagination_refetch_or_public_raw_exposure()
    {
        var profile=Path.Combine(root,"source-calls");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        var schema=JsonSerializer.SerializeToElement(new{type="object",properties=new{},required=Array.Empty<string>(),additionalProperties=false});
        var operation=new ModuleOperation("app_easysellput_test_summary","Original source",false,schema,"engine/main.mjs",["open_market_snapshot","read_market_snapshot"]);
        var script="import {createHostEngine} from "+HostSdkUri()+";import{createHash}from'node:crypto';const engine=await createHostEngine();try{const opened=await engine.call('open_market_snapshot',{kind:'chain',symbol:'QQQ',expiry:'2027-06-18'});async function read(meta){const chunks=[];for(let offset=0;offset<meta.size;){const chunk=await engine.call('read_market_snapshot',{receipt:meta.receipt,offset,length:32768});chunks.push(Buffer.from(chunk.bodyBase64,'base64'));offset+=chunk.chunkBytes;}return Buffer.concat(chunks);}const body=await read(opened),raw=await read(opened.raw),chain=JSON.parse(body);engine.finish({chain,rawSize:raw.length,rawHash:createHash('sha256').update(raw).digest('hex'),jsonHash:createHash('sha256').update(body).digest('hex'),advertised:opened.sha256});}finally{engine.close();}";
        await installer.InstallAsync(Package(operations:[operation],scriptText:script));
        var raw=Enumerable.Range(0,100001).Select(i=>(byte)(i%256)).ToArray();
        var chain=await new FakeMarket().GetChainAsync("QQQ",new(2027,6,18));
        var at=DateTimeOffset.Parse("2026-11-13T14:45:00Z");chain=chain with{RawSourcePayload=raw,UnderlyingLastTradeAt=at,AsOf=at.AddMinutes(15),FetchedAt=at.AddMinutes(16),DelayMinutes=15,UnderlyingPrice=100};
        using var service=new AutomationService(new(profile,Meili.Core.Settings.DataDirectorySource.CommandLine),new FakeMarket{ChainOverride=chain});
        using var host=service.BeginModuleHostSession();
        var bound=(await ModuleOperations.ReadAsync(profile,installer,CancellationToken.None)).Single();
        var result=await ModuleProcess.ExecuteAsync(profile,bound,JsonSerializer.SerializeToElement(new{}),false,installer,_=>Task.FromResult<string?>("node"),CancellationToken.None,host.InvokeAsync);
        Assert.True(JsonElement.DeepEquals(WireJson.Element(chain),result.GetProperty("chain")));Assert.Equal(raw.Length,result.GetProperty("rawSize").GetInt32());
        Assert.Equal(Convert.ToHexString(SHA256.HashData(raw)).ToLowerInvariant(),result.GetProperty("rawHash").GetString());Assert.Equal(result.GetProperty("jsonHash").GetString()!.ToUpperInvariant(),result.GetProperty("advertised").GetString());
        Assert.False(result.GetProperty("chain").TryGetProperty("rawSourcePayload",out _));Assert.False(File.Exists(Path.Combine(profile,"cache","qqq-gex.db")));
        var opened=(await host.InvokeAsync("open_market_snapshot",JsonSerializer.SerializeToElement(new{kind="chain",symbol="QQQ"}),CancellationToken.None)).GetProperty("data");
        var read=JsonSerializer.SerializeToElement(new{receipt=opened.GetProperty("receipt").GetString(),offset=0});
        using var foreign=service.BeginModuleHostSession();await Assert.ThrowsAsync<ArgumentException>(()=>foreign.InvokeAsync("read_market_snapshot",read,CancellationToken.None));
        await host.InvokeAsync("open_market_snapshot",JsonSerializer.SerializeToElement(new{kind="bars",symbol="QQQ"}),CancellationToken.None);
        await Assert.ThrowsAsync<ArgumentException>(()=>host.InvokeAsync("read_market_snapshot",read,CancellationToken.None));
        Assert.False((await host.InvokeAsync("open_market_snapshot",JsonSerializer.SerializeToElement(new{kind="chain",symbol="QQQ",interval="1d"}),CancellationToken.None)).GetProperty("success").GetBoolean());
    }

    [Fact]
    public async Task Signed_engine_reuses_typed_existing_market_and_analytics_without_losing_source_metadata()
    {
        var profile=Path.Combine(root,"host-calls");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        var schema=JsonSerializer.SerializeToElement(new{type="object",properties=new{},required=Array.Empty<string>(),additionalProperties=false});
        var operation=new ModuleOperation("app_easysellput_test_summary","Sourced calculation",false,schema,"engine/main.mjs",["get_quotes","calculate_option"]);
        var script="import {createHostEngine} from "+HostSdkUri()+";const engine=await createHostEngine();try{const market=await engine.call('get_quotes',{symbols:['AAPL']});const q=market.quotes[0];const calc=await engine.call('calculate_option',{right:'call',spot:q.price,strike:100,years:1,rate:0,volatility:.2});engine.finish({source:q.source,asOf:q.asOf,delayMinutes:q.delayMinutes,price:q.price,model:calc.model,value:calc.greeks.price});}finally{engine.close();}";
        await installer.InstallAsync(Package(operations:[operation],scriptText:script));
        using var service=new AutomationService(new(profile,Meili.Core.Settings.DataDirectorySource.CommandLine),new FakeMarket());
        var bound=(await ModuleOperations.ReadAsync(profile,installer,CancellationToken.None)).Single();
        var result=await ModuleProcess.ExecuteAsync(profile,bound,JsonSerializer.SerializeToElement(new{}),false,installer,_=>Task.FromResult<string?>("node"),CancellationToken.None,service.ExecuteHostOperationAsync);
        Assert.Equal("fixture",result.GetProperty("source").GetString());Assert.Equal(100,result.GetProperty("price").GetDouble());Assert.Equal(15,result.GetProperty("delayMinutes").GetInt32());
        Assert.Equal(DateTimeOffset.Parse("2026-11-13T15:00:00Z"),result.GetProperty("asOf").GetDateTimeOffset());Assert.True(result.GetProperty("value").GetDouble()>0);
        Assert.False(File.Exists(Path.Combine(profile,"settings.json")));
        await Assert.ThrowsAsync<InvalidDataException>(()=>installer.InstallAsync(Package(version:"1.0.1",operations:[operation with{HostOperations=["get_quotes","get_bars","calculate_option"]}],scriptText:script)));
        installer.Uninstall("easysellput.test");
    }

    [Fact]
    public async Task Host_capabilities_refuse_maintenance_and_cancel_provider_work_without_leaking_app_lease()
    {
        var profile=Path.Combine(root,"host-cancel");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        var schema=JsonSerializer.SerializeToElement(new{type="object",properties=new{},required=Array.Empty<string>(),additionalProperties=false});
        var operation=new ModuleOperation("app_easysellput_test_summary","Bounded market request",false,schema,"engine/main.mjs",["clear_cache"]);
        await Assert.ThrowsAsync<InvalidDataException>(()=>installer.InstallAsync(Package(operations:[operation])));
        operation=operation with{HostOperations=["get_quotes"]};
        var script="import {createHostEngine} from "+HostSdkUri()+";const engine=await createHostEngine();try{engine.finish(await engine.call('get_quotes',{symbols:['AAPL']}));}finally{engine.close();}";
        await installer.InstallAsync(Package(operations:[operation],scriptText:script));
        using var service=new AutomationService(new(profile,Meili.Core.Settings.DataDirectorySource.CommandLine),new FakeMarket{DelayQuotes=true});
        var bound=(await ModuleOperations.ReadAsync(profile,installer,CancellationToken.None)).Single();
        using var stop=new CancellationTokenSource(TimeSpan.FromMilliseconds(500));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>ModuleProcess.ExecuteAsync(profile,bound,JsonSerializer.SerializeToElement(new{}),false,installer,_=>Task.FromResult<string?>("node"),stop.Token,service.ExecuteHostOperationAsync));
        Assert.Equal("uninstalled",installer.Uninstall("easysellput.test").Status);
    }

    [Theory]
    [InlineData("undeclared")]
    [InlineData("duplicate")]
    [InlineData("trailing")]
    public async Task Host_frames_reject_undeclared_calls_reused_ids_and_trailing_output(string fault)
    {
        Directory.CreateDirectory(root);var script=Path.Combine(root,"bad-frame.mjs");
        var body=fault switch
        {
            "undeclared"=>"process.stdout.write(JSON.stringify({type:'hostCall',id:1,operation:'clear_cache',arguments:{category:'all'}})+'\\n');setInterval(()=>{},1000);",
            "duplicate"=>"const frame=JSON.stringify({type:'hostCall',id:1,operation:'get_quotes',arguments:{symbols:['AAPL']}})+'\\n';process.stdout.write(frame+frame);setInterval(()=>{},1000);",
            _=>"process.stdout.write(JSON.stringify({type:'result',result:{}})+'\\nnot-protocol');"
        };
        await File.WriteAllTextAsync(script,body);
        var calls=0;
        Task<JsonElement> Host(string name,JsonElement input,CancellationToken ct){calls++;return Task.FromResult(WireJson.Element(WireJson.Success(new{})));}
        if(fault=="trailing")await Assert.ThrowsAsync<InvalidDataException>(()=>ModuleProcess.RunHostAsync("node",script,new{},["get_quotes"],Host,CancellationToken.None));
        else await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>ModuleProcess.RunHostAsync("node",script,new{},["get_quotes"],Host,CancellationToken.None));
        Assert.Equal(fault=="duplicate"?1:0,calls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Engine_that_closes_stdin_before_the_request_is_a_protocol_failure(bool duplex)
    {
        Directory.CreateDirectory(root);var script=Path.Combine(root,"closed-input.mjs");
        await File.WriteAllTextAsync(script,"process.stdin.destroy();process.exit(0);");
        var request=new{payload=new string('x',512*1024)};
        if(duplex)await Assert.ThrowsAsync<InvalidDataException>(()=>ModuleProcess.RunHostAsync("node",script,request,[],(_,_,_)=>throw new InvalidOperationException("Unexpected host call"),CancellationToken.None));
        else await Assert.ThrowsAsync<InvalidDataException>(()=>ModuleProcess.RunAsync("node",script,request,CancellationToken.None));
    }

    [Fact]
    public async Task Companion_engines_are_explicit_signed_assets_not_caller_selected_paths()
    {
        var profile=Path.Combine(root,"companions");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        var schema=JsonSerializer.SerializeToElement(new{type="object",properties=new{},required=Array.Empty<string>(),additionalProperties=false});
        var operation=new ModuleOperation("app_easysellput_test_summary","Signed child engine",false,schema,"engine/main.mjs",EngineAssets:["engine/child.mjs"]);
        var script="import{execFileSync}from'node:child_process';let body='';for await(const chunk of process.stdin)body+=chunk;const request=JSON.parse(body);process.stdout.write(execFileSync(process.execPath,[request.context.assets['engine/child.mjs']]));";
        await installer.InstallAsync(Package(operations:[operation],scriptText:script,companions:new(){{"engine/child.mjs","process.stdout.write(JSON.stringify({source:'signed-companion',price:123.45}));"}}));
        var bound=(await ModuleOperations.ReadAsync(profile,installer,CancellationToken.None)).Single();
        var result=await ModuleProcess.ExecuteAsync(profile,bound,JsonSerializer.SerializeToElement(new{}),false,installer,_=>Task.FromResult<string?>("node"),CancellationToken.None);
        Assert.Equal("signed-companion",result.GetProperty("source").GetString());Assert.Equal(123.45,result.GetProperty("price").GetDouble());
        foreach(var invalid in new[]{new[]{"engine/missing.mjs"},new[]{"../foreign.mjs"},new[]{"engine/main.mjs","engine/main.mjs"}})
            await Assert.ThrowsAsync<InvalidDataException>(()=>installer.InstallAsync(Package(version:"1.0.1",operations:[operation with{EngineAssets=invalid}],scriptText:script)));
    }
    [Theory]
    [InlineData("invalid_arguments","invalid_arguments")]
    [InlineData("permission_denied","permission_denied")]
    [InlineData("cancelled","cancelled")]
    [InlineData("invalid_data","operation_failed")]
    public void App_errors_preserve_public_wire_error_categories(string code,string expected)
    {
        var value=JsonSerializer.SerializeToElement(new Dictionary<string,object>{{"$appError",new{code,message="Bounded app failure"}}});
        var error=Record.Exception(()=>ModuleProcess.DecodeResult(value));Assert.NotNull(error);
        Assert.Equal(expected,WireJson.Code(error));
    }

    [Fact]
    public async Task Broken_app_is_explicitly_unavailable_while_other_apps_and_builtin_tools_keep_working()
    {
        var profile=Path.Combine(root,"isolated-failure");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        var schema=JsonSerializer.SerializeToElement(new{type="object",properties=new{},required=Array.Empty<string>(),additionalProperties=false});
        var first=new ModuleOperation("app_easysellput_test_summary","First app",false,schema,"engine/main.mjs");
        var second=new ModuleOperation("app_other_fixture_summary","Second app",false,schema,"engine/main.mjs");
        await installer.InstallAsync(Package(operations:[first],scriptText:"process.stdout.write('{}');"));
        await installer.InstallAsync(Package(id:"other.fixture",operations:[second],scriptText:"process.stdout.write(JSON.stringify({source:'healthy-signed-app'}));"));
        var old=(await ModuleOperations.ReadAsync(profile,installer,CancellationToken.None)).Single(o=>o.AppId=="easysellput.test");
        var archive=installer.InstalledArchive(installer.Inspect().State.Apps.Single(a=>a.Id==old.AppId));await File.WriteAllBytesAsync(archive,[1,2,3]);
        var snapshot=await ModuleOperations.ReadSnapshotAsync(profile,installer,CancellationToken.None);
        Assert.Equal("easysellput.test",Assert.Single(snapshot.Issues).AppId);Assert.Equal("other.fixture",Assert.Single(snapshot.Operations).AppId);
        var invoked=false;
        await Assert.ThrowsAsync<AppUnavailableException>(()=>ModuleProcess.ExecuteAsync(profile,old,JsonSerializer.SerializeToElement(new{}),false,installer,_=>{invoked=true;return Task.FromResult<string?>("node");},CancellationToken.None));Assert.False(invoked);
        var healthy=await ModuleProcess.ExecuteAsync(profile,snapshot.Operations.Single(),JsonSerializer.SerializeToElement(new{}),false,installer,_=>Task.FromResult<string?>("node"),CancellationToken.None);
        Assert.Equal("healthy-signed-app",healthy.GetProperty("source").GetString());Assert.Equal(new byte[]{1,2,3},await File.ReadAllBytesAsync(archive));
        using var service=new AutomationService(new(profile,Meili.Core.Settings.DataDirectorySource.CommandLine),new FakeMarket());
        var quotes=await service.ExecuteAsync("get_quotes",JsonSerializer.SerializeToElement(new{symbols=new[]{"AAPL"}}),false);
        Assert.Equal(100,quotes.GetProperty("data").GetProperty("quotes")[0].GetProperty("price").GetDouble());
    }
    [Fact]
    public async Task Corrupt_app_registry_preserves_evidence_and_does_not_disable_host_pricing_or_market_tools()
    {
        var profile=Path.Combine(root,"bad-registry");Directory.CreateDirectory(Path.Combine(profile,"apps"));var path=Path.Combine(profile,"apps","registry.json");const string original="{retained corrupt fixture";await File.WriteAllTextAsync(path,original);
        using var service=new AutomationService(new(profile,Meili.Core.Settings.DataDirectorySource.CommandLine),new FakeMarket());
        var catalog=await service.GetCatalogAsync();Assert.Equal("app_registry_unavailable",Assert.Single(catalog.Issues).Code);Assert.NotNull(catalog.Find("get_quotes"));
        Assert.Throws<AppUnavailableException>(()=>catalog.Find("get_qqq_gex_replay"));
        var result=await service.ExecuteAsync("calculate_option",JsonSerializer.SerializeToElement(new{right="call",spot=100,strike=100,years=1,volatility=.2}),false);
        Assert.True(result.GetProperty("data").GetProperty("greeks").GetProperty("price").GetDouble()>0);
        Assert.Equal(original,await File.ReadAllTextAsync(path));
    }

    [Fact]
    public async Task Metadata_discovery_keeps_one_coherent_version_without_blocking_a_compatible_update()
    {
        var profile=Path.Combine(root,"discovery-race");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        var schema=JsonSerializer.SerializeToElement(new{type="object",properties=new{},required=Array.Empty<string>(),additionalProperties=false});
        var operation=new ModuleOperation("app_easysellput_test_summary","Stable contract",false,schema,"engine/main.mjs");
        await installer.InstallAsync(Package(operations:[operation]));var active=installer.Inspect().State.Apps.Single();var oldArchive=installer.InstalledArchive(active);
        var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);var release=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var reader=new ModuleInstaller(profile,async(file,ct)=>{var verified=await Verify(file);if(file==oldArchive){entered.TrySetResult();await release.Task.WaitAsync(ct);}return verified;});
        var pending=ModuleOperations.ReadSnapshotAsync(profile,reader,CancellationToken.None);
        try{await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));await installer.InstallAsync(Package(version:"1.0.1",operations:[operation,operation with{Name="app_easysellput_test_added"}]),updateOnly:true);}
        finally{release.TrySetResult();}
        Assert.Equal("1.0.0",Assert.Single((await pending).Operations).Version);
        var current=await ModuleOperations.ReadSnapshotAsync(profile,installer,CancellationToken.None);Assert.Empty(current.Issues);Assert.All(current.Operations,bound=>Assert.Equal("1.0.1",bound.Version));Assert.Equal(2,current.Operations.Count);
    }

    [Fact]
    public async Task Uninstall_retains_data_format_ownership_and_rejects_incompatible_reinstall()
    {
        var profile=Path.Combine(root,"retained-format");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        await installer.InstallAsync(Package(dataFormat:1));var data=Path.Combine(profile,"retained-observations.fixture");await File.WriteAllTextAsync(data,"untouched data");
        installer.Uninstall("easysellput.test");Assert.Equal(1,installer.Inspect().State.RetainedFormats!["easysellput.test"]);
        await Assert.ThrowsAsync<InvalidDataException>(()=>installer.InstallAsync(Package(version:"2.0.0",dataFormat:2)));
        Assert.Empty(installer.Inspect().State.Apps);Assert.Equal("untouched data",await File.ReadAllTextAsync(data));
        await installer.InstallAsync(Package(version:"1.0.1",dataFormat:1));Assert.Equal(1,installer.Inspect().State.Apps.Single().DataFormat);
    }
    [Fact]
    public async Task Explicit_exact_archive_repair_preserves_corrupt_evidence_and_does_not_bypass_contract_checks()
    {
        var profile=Path.Combine(root,"repair");var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));var package=Package();
        await installer.InstallAsync(package);var active=installer.Inspect().State.Apps.Single();var archive=installer.InstalledArchive(active);
        await File.WriteAllBytesAsync(archive,[1,2,3]);
        await Assert.ThrowsAsync<InvalidDataException>(()=>installer.InstallAsync(Package(version:"1.0.1",scriptText:"// Different candidate cannot bypass an unreadable previous contract")));
        await installer.InstallAsync(package);
        Assert.Equal(active.PackageSha256,(await installer.VerifyInstalledAsync(active.Id)).PackageSha256);
        var backup=Assert.Single(Directory.GetFiles(Path.Combine(profile,"apps","quarantine"),"package.espapp",SearchOption.AllDirectories));Assert.Equal(new byte[]{1,2,3},await File.ReadAllBytesAsync(backup));
    }
    [Fact]
    public async Task Legacy_GEX_data_cannot_be_adopted_as_an_incompatible_format_without_a_migration()
    {
        var profile=Path.Combine(root,"legacy-format");Directory.CreateDirectory(Path.Combine(profile,"cache"));var observations=Path.Combine(profile,"cache","qqq-gex.db");await File.WriteAllTextAsync(observations,"retained legacy evidence");
        var installer=new ModuleInstaller(profile,(file,ct)=>Verify(file));
        await Assert.ThrowsAsync<InvalidDataException>(()=>installer.InstallAsync(Package(id:ModuleAccess.QqqGex,dataFormat:2)));
        Assert.Equal("retained legacy evidence",await File.ReadAllTextAsync(observations));Assert.Empty(installer.Inspect().State.Apps);
    }

    [Theory]
    [InlineData("1.0.0 ")]
    [InlineData("01.0.0")]
    [InlineData("1.0.0.0")]
    public async Task Versions_are_canonical_portable_directory_components(string version) =>
        await Assert.ThrowsAsync<InvalidDataException>(()=>Verify(Package(version:version)));

    [Fact]
    public async Task Uninstall_never_reenables_compatibility_seed_and_explicit_reinstall_restores_access()
    {
        var profile = Path.Combine(root,"seed-policy");
        var installer = new ModuleInstaller(profile,(file,ct)=>Verify(file));
        Assert.True(ModuleAccess.IsEnabled(profile,"easysellput.test"));
        var package = Package();
        await installer.InstallAsync(package);
        installer.Uninstall("easysellput.test");
        Assert.False(ModuleAccess.IsEnabled(profile,"easysellput.test"));
        Assert.Throws<InvalidOperationException>(()=>ModuleAccess.AcquireEnabled(profile,"easysellput.test"));
        await installer.InstallAsync(package);
        Assert.True(ModuleAccess.IsEnabled(profile,"easysellput.test"));
    }

    [Fact]
    public async Task Fixed_host_executes_signed_A_then_B_and_rejects_stale_contracts_and_permission_escalation()
    {
        var profile = Path.Combine(root, "execution");
        var installer = new ModuleInstaller(profile, (file, ct) => Verify(file));
        var schema = JsonSerializer.SerializeToElement(new { type = "object", properties = new { }, required = Array.Empty<string>(), additionalProperties = false });
        var op = new ModuleOperation("app_easysellput_test_summary", "Evidence inventory", false, schema, "engine/main.mjs");
        var args = JsonSerializer.SerializeToElement(new { });
        Task<string?> Runtime(CancellationToken _) => Task.FromResult<string?>("node");
        await installer.InstallAsync(Package(operations: [op], scriptText: "process.stdout.write(JSON.stringify({version:'A',price:123.4567}));"));
        var a = Assert.Single(await ModuleOperations.ReadAsync(profile, installer, CancellationToken.None));
        Assert.Equal("A", (await ModuleProcess.ExecuteAsync(profile,a,args,false,installer,Runtime,CancellationToken.None)).GetProperty("version").GetString());
        await installer.InstallAsync(Package(version:"1.0.1",operations:[op],scriptText:"process.stdout.write(JSON.stringify({version:'B',price:123.4567}));"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => ModuleProcess.ExecuteAsync(profile,a,args,false,installer,Runtime,CancellationToken.None));
        var b = Assert.Single(await ModuleOperations.ReadAsync(profile, installer, CancellationToken.None));
        Assert.Equal("B", (await ModuleProcess.ExecuteAsync(profile,b,args,false,installer,Runtime,CancellationToken.None)).GetProperty("version").GetString());
        await Assert.ThrowsAsync<InvalidDataException>(() => installer.InstallAsync(Package(version:"1.0.2",operations:[op with { Writes=true }])));
        Assert.Equal("1.0.1", Assert.Single(installer.Inspect().State.Apps).Version);
        await installer.SetEnabledAsync("easysellput.test",false);
        Assert.False(ModuleAccess.IsEnabled(profile,"easysellput.test"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => ModuleProcess.ExecuteAsync(profile,b,args,false,installer,Runtime,CancellationToken.None));
    }

    [Fact]
    public async Task Signed_module_discovery_tracks_updates_and_disable_without_pinning_idle_clients()
    {
        var profile = Path.Combine(root, "catalog");
        var installer = new ModuleInstaller(profile, (file, ct) => Verify(file));
        var schema = JsonSerializer.SerializeToElement(new { type = "object", properties = new { }, required = Array.Empty<string>(), additionalProperties = false });
        var op = new ModuleOperation("app_easysellput_test_summary", "Retained evidence inventory", false, schema, "engine/main.mjs");
        await installer.InstallAsync(Package(operations: [op]));
        var a = await ModuleOperations.ReadAsync(profile, installer, CancellationToken.None);
        Assert.Equal("1.0.0", Assert.Single(a).Version);
        Assert.False(ModuleOperations.Merge(a).Find(op.Name).Writes);
        OperationCatalog.Validate(ModuleOperations.Merge(a).Find(op.Name), JsonSerializer.SerializeToElement(new { }));
        Assert.Throws<ArgumentException>(() => OperationCatalog.Validate(ModuleOperations.Merge(a).Find(op.Name), JsonSerializer.SerializeToElement(new { unexpected = true })));
        await installer.InstallAsync(Package(version: "1.0.1", operations: [op with { Description = "Updated evidence inventory" }]));
        var b = await ModuleOperations.ReadAsync(profile, installer, CancellationToken.None);
        Assert.Equal("1.0.1", Assert.Single(b).Version);
        Assert.Equal("1.0.0", Assert.Single(a).Version); // Existing immutable discovery is not mutated.
        await installer.SetEnabledAsync("easysellput.test", false);
        Assert.Empty(await ModuleOperations.ReadAsync(profile, installer, CancellationToken.None));
        installer.Uninstall("easysellput.test"); // Discovery never owns a permanent execution lock.
    }

    [Theory]
    [InlineData("calculate_option")]
    [InlineData("get_qqq_gex_foreign")]
    public async Task Signed_packages_cannot_steal_host_or_other_app_operations(string name)
    {
        var profile = Path.Combine(root, "foreign");
        var installer = new ModuleInstaller(profile, (file, ct) => Verify(file));
        var schema = JsonSerializer.SerializeToElement(new { type = "object", properties = new { }, required = Array.Empty<string>(), additionalProperties = false });
        await Assert.ThrowsAsync<InvalidDataException>(() => installer.InstallAsync(Package(operations: [new(name, "Foreign operation", false, schema, "engine/main.mjs")])));
        Assert.Empty(installer.Inspect().State.Apps);
    }

    [Fact]
    public async Task Signed_core_only_package_is_validated_without_extraction_or_activation()
    {
        var file = Package();
        var result = await Verify(file);
        Assert.Equal("easysellput.test", result.Manifest.Id);
        Assert.Null(result.Manifest.Ui);
        Assert.Equal(Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(file))), result.PackageSha256);
        Assert.Empty(Directory.GetDirectories(root));
    }
    [Fact]
    public async Task Wrong_key_tampered_code_wrong_source_and_unknown_host_api_are_rejected()
    {
        using var other = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        await Assert.ThrowsAsync<InvalidDataException>(() => Verify(Package(), other.ExportSubjectPublicKeyInfoPem()));
        await Assert.ThrowsAsync<InvalidDataException>(() => Verify(Package(tamper: true)));
        await Assert.ThrowsAsync<InvalidDataException>(() => Verify(Package(repository: "attacker/source")));
        await Assert.ThrowsAsync<InvalidDataException>(() => Verify(Package(api: 2)));
        await Assert.ThrowsAsync<InvalidDataException>(() => Verify(Package(extra: true)));
    }
    [Theory]
    [InlineData("../outside.mjs")]
    [InlineData("/engine/main.mjs")]
    [InlineData("engine\\main.mjs")]
    [InlineData("engine/main.mjs:stream")]
    [InlineData("engine/CON.mjs")]
    [InlineData("engine/../main.mjs")]
    [InlineData("engine/main.mjs.")]
    public async Task Unsafe_cross_platform_paths_are_rejected(string path) =>
        await Assert.ThrowsAsync<InvalidDataException>(() => Verify(Package(path)));

    [Fact]
    public async Task Explicit_install_update_disable_uninstall_and_reinstall_preserve_app_data()
    {
        var profile = Path.Combine(root, "profile");
        var installer = new ModuleInstaller(profile, (file, ct) => Verify(file));
        var a = Package(); var b = Package(version: "1.0.1");
        await installer.InstallAsync(a);
        var data = Path.Combine(profile, "apps", "data", "easysellput.test"); Directory.CreateDirectory(data);
        File.WriteAllText(Path.Combine(data, "history"), "original observations");
        await installer.InstallAsync(b);
        Assert.Equal("1.0.1", (await installer.VerifyInstalledAsync("easysellput.test")).Manifest.Version);
        await Assert.ThrowsAsync<InvalidDataException>(() => installer.InstallAsync(a));
        await installer.SetEnabledAsync("easysellput.test", false);
        await Assert.ThrowsAsync<ArgumentException>(() => installer.VerifyInstalledAsync("easysellput.test"));
        await installer.SetEnabledAsync("easysellput.test", true);
        Assert.Equal("uninstalled", installer.Uninstall("easysellput.test").Status);
        Assert.Empty(installer.Inspect().State.Apps);
        await installer.InstallAsync(b);
        Assert.Equal("original observations", File.ReadAllText(Path.Combine(data, "history")));
    }

    [Fact]
    public async Task Active_execution_and_invalid_code_cannot_replace_registration()
    {
        var profile = Path.Combine(root, "profile");
        var installer = new ModuleInstaller(profile, (file, ct) => Verify(file));
        await installer.InstallAsync(Package());
        var before = installer.Inspect();
        using (new ModuleRegistry(profile).AcquireExecution("easysellput.test"))
            await Assert.ThrowsAsync<IOException>(() => installer.InstallAsync(Package(version: "1.0.1")));
        await Assert.ThrowsAsync<InvalidDataException>(() => installer.InstallAsync(Package(tamper: true, version: "1.0.2")));
        Assert.Equal(before.Revision, installer.Inspect().Revision);
        Assert.Equal("1.0.0", Assert.Single(installer.Inspect().State.Apps).Version);
    }

    [Fact]
    public async Task Recovery_reconciles_committed_pointer_but_never_activates_an_uncommitted_candidate()
    {
        var profile = Path.Combine(root, "profile");
        var installer = new ModuleInstaller(profile, (file, ct) => Verify(file));
        await installer.InstallAsync(Package());
        var folder = Path.Combine(profile, "apps", "transactions");
        var journal = Directory.GetFiles(folder, "*.json").Single();
        File.WriteAllText(journal, File.ReadAllText(journal).Replace("activated", "staged"));
        var before = installer.Inspect();
        Assert.Equal(1, installer.RecoverPending());
        Assert.Contains("reconciled_active", File.ReadAllText(journal));
        var abandoned = Path.Combine(folder, "uncommitted.json");
        File.WriteAllText(abandoned, JsonSerializer.Serialize(new { schemaVersion = 1, id = "easysellput.test",
            version = "2.0.0", packageSha256 = new string('B', 64), phase = "verified" }));
        Assert.Equal(1, installer.RecoverPending());
        Assert.Contains("abandoned", File.ReadAllText(abandoned));
        Assert.Equal(before.Revision, installer.Inspect().Revision);
        Assert.Equal(0, installer.RecoverPending());
    }

    [Fact]
    public async Task Installed_asset_holds_execution_version_until_disposed_and_never_falls_back_after_tampering()
    {
        var profile = Path.Combine(root, "profile");
        var installer = new ModuleInstaller(profile, (file, ct) => Verify(file));
        Assert.Null(await ModuleAssets.TryOpenAsync(profile, "easysellput.test", "engine/main.mjs", installer, CancellationToken.None));
        Assert.False(Directory.Exists(profile));
        await installer.InstallAsync(Package());
        using (var asset = await ModuleAssets.TryOpenAsync(profile, "easysellput.test", "engine/main.mjs", installer, CancellationToken.None))
        {
            Assert.NotNull(asset);
            using var read = new StreamReader(asset.OpenRead());
            Assert.Equal("export const value=1;", await read.ReadToEndAsync());
            Assert.Throws<IOException>(() => installer.Uninstall("easysellput.test"));
        }
        var archive = installer.InstalledArchive(installer.Inspect().State.Apps.Single());
        File.WriteAllBytes(archive, [1, 2, 3]);
        await Assert.ThrowsAsync<InvalidDataException>(() => ModuleAssets.TryOpenAsync(profile, "easysellput.test", "engine/main.mjs", installer, CancellationToken.None));
        Assert.Equal("uninstalled", installer.Uninstall("easysellput.test").Status);
    }

    public void Dispose() { key.Dispose(); if (Directory.Exists(root)) Directory.Delete(root, true); }
}
