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
    private string Package(string path = "engine/main.mjs", bool tamper = false, string repository = "test/source", int api = 1, bool extra = false, string version = "1.0.0", ModuleOperation[]? operations = null, string scriptText = "export const value=1;", bool ui = false, string id = "easysellput.test", Dictionary<string,string>? companions = null)
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
        var manifest = new ModuleManifest(1, repository, id, version, api, 1, 1, "node24", path, ui ? "ui/index.html" : null,
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

    private static string HostSdkUri()
    {
        var directory=AppContext.BaseDirectory;
        while(!File.Exists(Path.Combine(directory,"MeiliTerminal.slnx")))directory=Path.GetDirectoryName(directory)??throw new IOException("Missing repository.");
        return JsonSerializer.Serialize(new Uri(Path.Combine(directory,"web","app-sdk","engine-host.mjs")).AbsoluteUri);
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
