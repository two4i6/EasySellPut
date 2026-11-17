using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using Meili.Automation;
using Meili.Automation.Apps.QqqGex;
using Meili.Automation.Modules;
using Meili.Shared.Services;

internal static partial class Program
{
    // Source/test-only signing. The production host never accepts this key.
    private sealed class SignedGexFixture : IDisposable
    {
        private readonly ECDsa key=ECDsa.Create(ECCurve.NamedCurves.nistP256);
        internal ModuleInstaller Installer { get; }
        internal NativeAppDispatcher Dispatcher { get; }
        internal string Archive { get; }
        private readonly string profile;
        internal SignedGexFixture(string profile,string directory)
        {
            this.profile=profile;
            var root=new DirectoryInfo(Environment.CurrentDirectory);
            while(root is not null&&!File.Exists(Path.Combine(root.FullName,"MeiliTerminal.slnx")))root=root.Parent;
            if(root is null)throw new DirectoryNotFoundException("Native signed GEX fixture requires the source checkout.");
            var source=Path.Combine(root.FullName,"web","qqq-gex");
            var payload=new Dictionary<string,byte[]>(StringComparer.Ordinal);
            foreach(var name in new[]{"import.mjs","query.mjs","history.mjs","retained-summary.mjs","operations.mjs","capture.mjs","view.mjs"})
                payload["engine/"+name]=File.ReadAllBytes(Path.Combine(source,"runtime-dist",name));
            payload["operations.json"]=File.ReadAllBytes(Path.Combine(source,"operations.json"));
            var ui=Path.Combine(source,"dist");
            foreach(var file in Directory.EnumerateFiles(ui,"*",SearchOption.AllDirectories))
                if(Path.GetFileName(file)!="build-manifest.json")payload["ui/"+Path.GetRelativePath(ui,file).Replace('\\','/')]=File.ReadAllBytes(file);
            foreach(var name in new[]{"source-manifest.json","node-runtime-lock.json","public-contracts.json","UPSTREAM-STATUS.md","SOURCE-TIMING.md"})
                payload["notices/"+name]=File.ReadAllBytes(Path.Combine(source,name));
            payload["notices/EasySellPut-LICENSE"]=File.ReadAllBytes(Path.Combine(root.FullName,"LICENSE"));
            using var sourceManifest=JsonDocument.Parse(payload["notices/source-manifest.json"]);
            var manifest=new ModuleManifest(1,"test/native",ModuleAccess.QqqGex,"1.0.0",1,1,1,"node24","engine/import.mjs","ui/index.html",[UpdateClient.RuntimeId],payload.Select(p=>new ModuleFile(p.Key,p.Value.Length,Convert.ToHexString(SHA256.HashData(p.Value)))).ToArray(),sourceManifest.RootElement.GetProperty("commit").GetString());
            var body=JsonSerializer.SerializeToUtf8Bytes(manifest,new JsonSerializerOptions(JsonSerializerDefaults.Web));
            Archive=Path.Combine(directory,"signed-original-gex.espapp");
            using(var zip=ZipFile.Open(Archive,ZipArchiveMode.Create))
            {
                void Add(string name,byte[] bytes){using var output=zip.CreateEntry(name).Open();output.Write(bytes);}
                Add("app.json",body);Add("app.sig",key.SignData(body,HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence));
                foreach(var item in payload)Add(item.Key,item.Value);
            }
            Installer=new(profile,(file,ct)=>ModulePackage.VerifyAsync(file,key.ExportSubjectPublicKeyInfoPem(),"test/native",UpdateClient.RuntimeId,ct));
            Dispatcher=new(profile,Installer);
        }
        internal string CreateUpdate()
        {
            using var original=ZipFile.OpenRead(Archive);
            var payload=new Dictionary<string,byte[]>();
            foreach(var entry in original.Entries)
            {
                if(entry.FullName is "app.json" or "app.sig")continue;
                using var stream=entry.Open();using var memory=new MemoryStream();stream.CopyTo(memory);payload[entry.FullName]=memory.ToArray();
            }
            var operations=System.Text.Json.Nodes.JsonNode.Parse(payload["operations.json"])!.AsArray();
            var added=operations.Single(o=>o!["name"]!.GetValue<string>()=="get_qqq_gex_retained_summary")!.DeepClone();
            added["name"]="get_qqq_gex_retained_summary_v2";added["entryPoint"]="engine/retained-summary-v2.mjs";operations.Add(added);
            payload["operations.json"]=System.Text.Encoding.UTF8.GetBytes(operations.ToJsonString());
            payload["engine/retained-summary-v2.mjs"]=System.Text.Encoding.UTF8.GetBytes(System.Text.Encoding.UTF8.GetString(payload["engine/retained-summary.mjs"]).Replace("get_qqq_gex_retained_summary","get_qqq_gex_retained_summary_v2",StringComparison.Ordinal));
            var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);
            using var manifestStream=original.GetEntry("app.json")!.Open();
            var manifest=JsonSerializer.Deserialize<ModuleManifest>(manifestStream,json)!;
            manifest=manifest with{Version="1.0.1",Files=payload.Select(p=>new ModuleFile(p.Key,p.Value.Length,Convert.ToHexString(SHA256.HashData(p.Value)))).ToArray()};
            var body=JsonSerializer.SerializeToUtf8Bytes(manifest,json);
            var pathOut=Path.Combine(Path.GetDirectoryName(Archive)!,"signed-original-gex-update.espapp");
            using var zip=ZipFile.Open(pathOut,ZipArchiveMode.Create);
            void Add(string name,byte[] bytes){using var output=zip.CreateEntry(name).Open();output.Write(bytes);}
            Add("app.json",body);Add("app.sig",key.SignData(body,HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence));
            foreach(var item in payload)Add(item.Key,item.Value);
            return pathOut;
        }
        internal async Task<QqqGexAppSession> OpenAsync()
        {
            await Installer.VerifyInstalledAsync(ModuleAccess.QqqGex,CancellationToken.None);
            async Task<object> Query(string path,CancellationToken ct)
            {
                QqqGexCalculationRunner.ValidateQuery(path);
                using var job=await ModuleJobs.AcquireAsync(profile,ModuleAccess.QqqGex,ct,readOnly:true);
                using var asset=await ModuleAssets.TryOpenAsync(profile,ModuleAccess.QqqGex,"engine/query.mjs",Installer,ct)??throw new InvalidDataException("Missing signed native GEX query.");
                var node=await PinnedNodeRuntime.ExtractNodeAsync(profile,ct)??throw new InvalidDataException("Missing pinned native runtime.");
                return await QqqGexCalculationRunner.RunVerifiedModelAsync(node,await asset.MaterializeScriptAsync(ct),profile,"query.mjs",path,ct);
            }
            return new QqqGexAppSession(Path.Combine(profile,"cache","qqq-gex.db"),"local",null,null,new PrivateAppOperations(profile,ModuleAccess.QqqGex,Dispatcher,false,Installer),null,Installer,Query);
        }
        public void Dispose(){Dispatcher.Dispose();key.Dispose();}
    }
}
