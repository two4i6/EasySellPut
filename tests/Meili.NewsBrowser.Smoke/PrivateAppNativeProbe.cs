using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Meili.Automation;
using Meili.Automation.Modules;
using Meili.Core.Settings;
#if WINDOWS_READER
using System.Windows;
using Microsoft.Web.WebView2.Wpf;
using FixtureView=Meili.App.Views.Controls.PrivateAppView;
#else
using Avalonia.Controls;
using Meili.Mac.Platform;
using FixtureView=Meili.Mac.Views.Controls.PrivateAppView;
#endif

internal static partial class Program
{
    private sealed class NativeAppDispatcher(string directory,ModuleInstaller installer):IOperationDispatcher
    {
        public DataDirectoryInfo DirectoryInfo=>new(directory,DataDirectorySource.CommandLine);
        public async Task<IOperationCatalog> GetCatalogAsync(CancellationToken ct=default)=>ModuleOperations.Merge(await ModuleOperations.ReadAsync(directory,installer,ct));
        public async Task<JsonElement> ExecuteAsync(string name,JsonElement arguments,bool writes,CancellationToken ct=default)
        {
            var operation=(await ModuleOperations.ReadAsync(directory,installer,ct)).Single(o=>o.Definition.Name==name);
            return WireJson.Element(WireJson.Success(await ModuleProcess.ExecuteAsync(directory,operation,arguments,writes,installer,token=>PinnedNodeRuntime.ExtractNodeAsync(directory,token),ct)));
        }
        public void Dispose(){}
    }
    private static async Task ProbePrivateApp(string directory)
    {
        var profile=Path.Combine(directory,"signed-native-app");Directory.CreateDirectory(profile);
        var marker=Path.Combine(profile,"retained-evidence.fixture");await File.WriteAllTextAsync(marker,"retained fixture, not live data");
        using var key=ECDsa.Create(ECCurve.NamedCurves.nistP256);var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var schema=JsonSerializer.SerializeToElement(new{type="object",properties=new{},required=Array.Empty<string>(),additionalProperties=false});
        var operation=new ModuleOperation("app_easysellput_fixture_status","Native signed fixture",false,schema,"engine/main.mjs");
        var payload=new Dictionary<string,byte[]>
        {
            ["engine/main.mjs"]=Encoding.UTF8.GetBytes("let input='';for await(const part of process.stdin)input+=part;const request=JSON.parse(input);if(request.operation!=='app_easysellput_fixture_status'||request.context.allowWrites)throw Error('Wrong scope');process.stdout.write(JSON.stringify({source:'native signed fixture',value:42}));"),
            ["operations.json"]=JsonSerializer.SerializeToUtf8Bytes(new[]{operation},json),
            ["ui/index.html"]=Encoding.UTF8.GetBytes("<!doctype html><title>Native signed app loading</title><h1>Native signed AppView fixture</h1><script src=main.mjs type=module></script>"),
            ["ui/main.mjs"]=Encoding.UTF8.GetBytes("const catalog=await(await fetch('host/catalog')).json();if(catalog.operations.length!==1||catalog.operations[0].name!=='app_easysellput_fixture_status'||catalog.allowWrites)throw Error('Catalog scope');const response=await fetch('host/invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'app_easysellput_fixture_status',arguments:{}})});const value=await response.json();if(!value.success||value.data.value!==42||value.data.source!=='native signed fixture')throw Error('Engine result');document.title='Native signed app READY 42';")
        };
        var manifest=new ModuleManifest(1,"test/native","easysellput.fixture","1.0.0",1,1,1,"node24","engine/main.mjs","ui/index.html",[UpdateClient.RuntimeId],payload.Select(p=>new ModuleFile(p.Key,p.Value.Length,Convert.ToHexString(SHA256.HashData(p.Value)))).ToArray());
        var body=JsonSerializer.SerializeToUtf8Bytes(manifest,json);var archive=Path.Combine(directory,"signed-native-fixture.espapp");
        using(var zip=ZipFile.Open(archive,ZipArchiveMode.Create))
        {
            void Add(string name,byte[] bytes){using var output=zip.CreateEntry(name).Open();output.Write(bytes);}
            Add("app.json",body);Add("app.sig",key.SignData(body,HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence));foreach(var file in payload)Add(file.Key,file.Value);
        }
        var installer=new ModuleInstaller(profile,(file,ct)=>ModulePackage.VerifyAsync(file,key.ExportSubjectPublicKeyInfoPem(),"test/native",UpdateClient.RuntimeId,ct));
        await installer.InstallAsync(archive);
        using var dispatcher=new NativeAppDispatcher(profile,installer);
        var session=await PrivateAppSession.CreateAsync(profile,manifest.Id,dispatcher,false,installer,CancellationToken.None);
#if WINDOWS_READER
        var view=new FixtureView();
#else
        var view=new FixtureView(session);
#endif
        var window=new Window{Width=1920,Height=1080,Content=view};
        try
        {
            window.Show();window.Activate();
#if WINDOWS_READER
            await view.NavigateAsync(session,Path.Combine(directory,"signed-app-browser"));
            var browser=(WebView2)typeof(FixtureView).GetField("browser",BindingFlags.Instance|BindingFlags.NonPublic)!.GetValue(view)!;
            await Until(()=>browser.CoreWebView2.DocumentTitle=="Native signed app READY 42","signed app WebView2 HTTP/engine journey");
            if(browser.CoreWebView2.Settings.AreHostObjectsAllowed||browser.CoreWebView2.Settings.IsWebMessageEnabled)throw new Exception("Native host privileges enabled");
            var blocked=false;browser.CoreWebView2.NavigationStarting+=(_,e)=>{if(e.Uri=="https://foreign.invalid/")blocked=e.Cancel;};
            browser.CoreWebView2.Navigate("https://foreign.invalid/");await Until(()=>blocked,"private app blocks external WebView2 navigation");
#else
            var browser=(NewsWebView)view.Content!;
            await Until(()=>browser.DocumentTitle=="Native signed app READY 42","signed app WKWebView HTTP/engine journey");
            var address=browser.Address;browser.Navigate("https://foreign.invalid/");
            if(browser.StatusKey!="Reader_Blocked"||browser.Address!=address)throw new Exception("Private app WKWebView accepted external navigation");
#endif
            var excluded=false;try{installer.Uninstall(manifest.Id);}catch(IOException){excluded=true;}
            if(!excluded)throw new Exception("Native app view failed to pin execution ownership");
        }
        finally{view.Dispose();window.Content=null;window.Close();await session.DisposeAsync();}
        installer.Uninstall(manifest.Id);
        if(await File.ReadAllTextAsync(marker)!="retained fixture, not live data")throw new Exception("Native app uninstall lost evidence");
        Console.WriteLine("PASS: actual signed private AppView in native engine, app-owned Node result, read-only scope, external navigation blocked, execution pin and uninstall preservation (fixture, not live).");
    }
}
