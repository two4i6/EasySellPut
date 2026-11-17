using System.Text.Json;
using Meili.Automation;
using Meili.Automation.Modules;
using Meili.Core.Settings;

internal static class AppFixture
{
    public static void Create(string directory)
    {
        Directory.CreateDirectory(directory);
        using var key=System.Security.Cryptography.ECDsa.Create(System.Security.Cryptography.ECCurve.NamedCurves.nistP256);
        File.WriteAllText(Path.Combine(directory,"public.pem"),key.ExportSubjectPublicKeyInfoPem());
        foreach(var version in new[]{"1.0.0","1.0.1"})
        {
            var script=System.Text.Encoding.UTF8.GetBytes("let input='';for await(const c of process.stdin)input+=c;const request=JSON.parse(input);process.stdout.write(JSON.stringify({fixture:true,version:'"+version+"',operation:request.operation,allowWrites:request.context.allowWrites}));");
            var schema=JsonSerializer.SerializeToElement(new{type="object",properties=new{},required=Array.Empty<string>(),additionalProperties=false});
            var definitions=new List<ModuleOperation>{
                new ModuleOperation("app_easysellput_test_summary","Fixture evidence summary",false,schema,"engine/main.mjs"),
                new ModuleOperation("app_easysellput_test_record","Fixture explicit recording",true,schema,"engine/main.mjs"),
                new ModuleOperation("app_easysellput_test_market","Fixture shared provider request",false,schema,"engine/host.mjs",["get_quotes"])};
            if(version=="1.0.1")definitions.Add(new("app_easysellput_test_added","Fixture added operation",false,schema,"engine/main.mjs"));
            var operations=JsonSerializer.SerializeToUtf8Bytes(definitions,new JsonSerializerOptions(JsonSerializerDefaults.Web));
            var hostScript=System.Text.Encoding.UTF8.GetBytes("import{createInterface}from'node:readline';const lines=createInterface({input:process.stdin})[Symbol.asyncIterator]();await lines.next();process.stdout.write(JSON.stringify({type:'hostCall',id:1,operation:'get_quotes',arguments:{symbols:['AAPL']}})+'\\n');const reply=JSON.parse((await lines.next()).value);process.stdout.write(JSON.stringify({type:'result',result:reply.result.data})+'\\n');await lines.return();process.stdin.pause();");
            var payload=new Dictionary<string,byte[]>{{"engine/main.mjs",script},{"engine/host.mjs",hostScript},{"operations.json",operations}};
            var manifest=new ModuleManifest(1,"test/source","easysellput.test",version,1,1,1,"node24","engine/main.mjs",null,
                [System.Runtime.InteropServices.RuntimeInformation.RuntimeIdentifier],payload.Select(p=>new ModuleFile(p.Key,p.Value.Length,Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(p.Value)))).ToArray());
            var body=JsonSerializer.SerializeToUtf8Bytes(manifest,new JsonSerializerOptions(JsonSerializerDefaults.Web));
            using var zip=System.IO.Compression.ZipFile.Open(Path.Combine(directory,version+".espapp"),System.IO.Compression.ZipArchiveMode.Create);
            void Add(string name,byte[] bytes){using var stream=zip.CreateEntry(name).Open();stream.Write(bytes);}
            Add("app.json",body);Add("app.sig",key.SignData(body,System.Security.Cryptography.HashAlgorithmName.SHA256,System.Security.Cryptography.DSASignatureFormat.Rfc3279DerSequence));
            foreach(var item in payload)Add(item.Key,item.Value);
        }
    }

    public static async Task<int> RunAsync(string publicKey, string runtime, string[] args,string? captureFixture=null)
    {
        var key = File.ReadAllText(publicKey);
        ModuleInstaller Installer(string path) => new(path, (file, token) => ModulePackage.VerifyAsync(file,key,"test/source",System.Runtime.InteropServices.RuntimeInformation.RuntimeIdentifier,token));
        if(args.Length==3 && args[0]=="install")
        {
            try { Console.WriteLine(JsonSerializer.Serialize(await Installer(args[1]).InstallAsync(args[2]))); return 0; }
            catch(IOException e) { Console.Error.WriteLine(e.Message); return 1; }
        }
        async Task<IOperationCatalog> Catalog(string? path)
        {
            var directory = LocalPaths.Resolve(path,migrateLegacy:false);
            var snapshot=await ModuleOperations.ReadSnapshotAsync(directory.Path,Installer(directory.Path),CancellationToken.None);return ModuleOperations.Merge(snapshot.Operations,snapshot.Issues);
        }
        return await Meili.Cli.Program.RunAsync(args, directory=>new Dispatcher(directory,Installer(directory.Path),runtime,captureFixture),Catalog);
    }
    private sealed class Dispatcher(DataDirectoryInfo directory, ModuleInstaller installer, string runtime,string? captureFixture) : IOperationDispatcher
    {
        private readonly AutomationService fallback = new(directory,captureFixture is not null?GexCaptureFixture.Market(captureFixture):new Meili.Automation.Tests.FakeMarket());
        public DataDirectoryInfo DirectoryInfo => directory;
        public async Task<IOperationCatalog> GetCatalogAsync(CancellationToken ct=default) {var snapshot=await ModuleOperations.ReadSnapshotAsync(directory.Path,installer,ct);return ModuleOperations.Merge(snapshot.Operations,snapshot.Issues);}
        public async Task<JsonElement> ExecuteAsync(string operation, JsonElement arguments, bool allowWrites, CancellationToken ct=default)
        {
            var op=(await GetCatalogAsync(ct)).Find(operation);OperationCatalog.Validate(op,arguments);
            if(op.Writes&&!allowWrites)throw new UnauthorizedAccessException();
            var bound=(await ModuleOperations.ReadAsync(directory.Path,installer,ct)).SingleOrDefault(o=>o.Definition.Name==operation);
            using var hostSession=fallback.BeginModuleHostSession();
            return bound is null?await fallback.ExecuteAsync(operation,arguments,allowWrites,ct):
                WireJson.Element(WireJson.Success(await ModuleProcess.ExecuteAsync(directory.Path,bound,arguments,allowWrites,installer,_=>Task.FromResult<string?>(runtime),ct,hostSession.InvokeAsync)));
        }
        public void Dispose()=>fallback.Dispose();
    }
}
