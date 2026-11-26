using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Meili.Automation.Modules;

/// <summary>Test-only signatures over actual app build outputs. No production trust flag or private key file.</summary>
internal static class GexAppFixture
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    public static void Create(string source,string directory)
    {
        if(new FileInfo(source).Length>512L*1024*1024)throw new InvalidDataException("Fixture archive exceeds bound.");
        using var archive=ZipFile.OpenRead(source);
        using var metadata=archive.GetEntry("app.json")!.Open();
        var original=JsonSerializer.Deserialize<ModuleManifest>(metadata,Json)??throw new InvalidDataException("Missing fixture manifest.");
        if(original.Id!="easysellput.qqq-gex")throw new InvalidDataException("Expected actual GEX output.");
        var payload=new Dictionary<string,byte[]>(StringComparer.Ordinal);
        foreach(var file in original.Files)
        {
            using var input=archive.GetEntry(file.Path)!.Open();using var output=new MemoryStream();input.CopyTo(output);var bytes=output.ToArray();
            if(bytes.LongLength!=file.Size||!Convert.ToHexString(SHA256.HashData(bytes)).Equals(file.Sha256,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Fixture payload differs from built artifact.");
            payload.Add(file.Path,bytes);
        }
        Directory.CreateDirectory(directory);
        using var key=ECDsa.Create(ECCurve.NamedCurves.nistP256);
        File.WriteAllText(Path.Combine(directory,"public.pem"),key.ExportSubjectPublicKeyInfoPem());
        foreach(var version in new[]{"1.0.0","1.0.1"})foreach(var ui in new[]{false,true})
        {
            if(ui&&original.Ui is null)continue;
            var files=payload.Where(p=>ui||!p.Key.StartsWith("ui/",StringComparison.Ordinal)).ToDictionary(p=>p.Key,p=>p.Value,StringComparer.Ordinal);
            if(version=="1.0.1")
            {
                var operations=JsonSerializer.Deserialize<ModuleOperation[]>(files["operations.json"],Json)!.ToList();
                var previous=operations.Single(o=>o.Name=="get_qqq_gex_retained_summary");
                operations.Add(previous with{Name="get_qqq_gex_retained_summary_v2",EntryPoint="engine/retained-summary-v2.mjs"});
                // A bounded real retained-data reader added only to app B; original model bundles are untouched.
                files["engine/retained-summary-v2.mjs"]=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(files[previous.EntryPoint]).Replace("get_qqq_gex_retained_summary","get_qqq_gex_retained_summary_v2",StringComparison.Ordinal));
                files["operations.json"]=JsonSerializer.SerializeToUtf8Bytes(operations,Json);
            }
            var manifest=original with{Repository="test/source",Version=version,Ui=ui?original.Ui:null,
                Files=files.OrderBy(p=>p.Key,StringComparer.Ordinal).Select(p=>new ModuleFile(p.Key,p.Value.LongLength,Convert.ToHexString(SHA256.HashData(p.Value)))).ToArray()};
            var body=JsonSerializer.SerializeToUtf8Bytes(manifest,Json);
            using var zip=ZipFile.Open(Path.Combine(directory,version+(ui?"-ui":"-core")+".espapp"),ZipArchiveMode.Create);
            void Add(string name,byte[] bytes){using var stream=zip.CreateEntry(name).Open();stream.Write(bytes);}
            Add("app.json",body);Add("app.sig",key.SignData(body,HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence));
            foreach(var file in files)Add(file.Key,file.Value);
        }
    }
}
