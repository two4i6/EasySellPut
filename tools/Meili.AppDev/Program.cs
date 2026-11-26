using System.Text.Json;
using Meili.Automation;
using Meili.Automation.Modules;
using Meili.Automation.Apps.QqqGex;
using System.Text;
using Meili.Core.Settings;

internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
        try{return await RunAsync(args);}
        catch(Exception ex){Console.Error.WriteLine(WireJson.Element(WireJson.Error(ex)).GetRawText());return ex is ArgumentException?2:1;}
    }
    private static async Task<int> RunAsync(string[] args)
    {
// Separate source-development host. Never packaged; no existing/portable user profile can be selected.
var options=new Dictionary<string,string>(StringComparer.Ordinal);
for(var i=0;i<args.Length;i++)
{
    if(!args[i].StartsWith("--",StringComparison.Ordinal)||i+1>=args.Length||!options.TryAdd(args[i][2..],args[++i]))throw new ArgumentException("Use --package PATH --public-key PATH --repository OWNER/REPO [--node PATH] [--operation NAME] [--input PATH] [--seed-input PATH] [--view auto|generic] [--theme light|dark] [--language zh-CN|en-US].");
}
if(options.Keys.Any(k=>k is not("package" or "public-key" or "repository" or "node" or "operation" or "input" or "seed-input" or "view" or "theme" or "language")))throw new ArgumentException("Unsupported development option; production data directories are never accepted.");
foreach(var required in new[]{"package","public-key","repository"})if(!options.ContainsKey(required))throw new ArgumentException("Missing --"+required);
var publicFile=new FileInfo(options["public-key"]);if(publicFile.Length>8192)throw new InvalidDataException("Oversized development public key.");
var key=await File.ReadAllTextAsync(publicFile.FullName);var repository=options["repository"];if(!UpdateClient.IsValidRepository(repository))throw new ArgumentException("Invalid development repository.");
var node=options.GetValueOrDefault("node","node");
var viewKind=options.GetValueOrDefault("view","auto");if(viewKind is not ("auto" or "generic"))throw new ArgumentException("View must be auto or generic.");
var themeName=options.GetValueOrDefault("theme","dark");if(themeName is not ("light" or "dark"))throw new ArgumentException("Theme must be light or dark.");
var language=options.GetValueOrDefault("language","zh-CN");if(language is not ("zh-CN" or "en-US"))throw new ArgumentException("Language must be zh-CN or en-US.");
var presentation=WireJson.Element(new{language,theme=AppThemeDefaults.Create(themeName=="dark")});
var profile=Path.Combine(Path.GetTempPath(),"EasySellPut-AppDev-"+Guid.NewGuid().ToString("N"));
using var stop=new CancellationTokenSource();Console.CancelKeyPress+=(_,e)=>{e.Cancel=true;stop.Cancel();};
try
{
    var installer=new ModuleInstaller(profile,(archive,ct)=>ModulePackage.VerifyAsync(archive,key,repository,UpdateClient.RuntimeId,ct));
    await installer.InstallAsync(options["package"],stop.Token);
    using var dispatcher=new DevDispatcher(profile,installer,node);var app=installer.Inspect().State.Apps.Single();
    if(options.TryGetValue("seed-input",out var seed))await dispatcher.SeedAsync(seed,stop.Token);
    if(options.TryGetValue("operation",out var operation))
    {
        if(options.TryGetValue("input",out var inputFile)&&new FileInfo(inputFile).Length>1048576)throw new ArgumentException("Development input exceeds 1 MiB.");
        using var arguments=JsonDocument.Parse(options.TryGetValue("input",out var input)?await File.ReadAllTextAsync(input,stop.Token):"{}",new JsonDocumentOptions{MaxDepth=16});
        Console.WriteLine((await dispatcher.ExecuteAsync(operation,arguments.RootElement,false,stop.Token)).GetRawText());return 0;
    }
    if(app.HasUi!=true)throw new ArgumentException("Core-only app: use --operation, or select an app package with UI.");
    async Task Preview(IPrivateAppSession session)
    {
        Console.WriteLine(WireJson.Element(new{development=true,readOnly=true,temporaryProfile=profile,page=session.PageUri.AbsoluteUri}).GetRawText());
        Console.Error.WriteLine("Development preview only. Open the private URL; Enter/EOF or Ctrl+C stops it. No existing user profile is loaded.");
        try{await Console.In.ReadLineAsync(stop.Token);}catch(OperationCanceledException){}
    }
    if(app.Id==ModuleAccess.QqqGex&&viewKind!="generic")
    {
        await installer.VerifyInstalledAsync(app.Id,stop.Token);
        async Task<object> Query(string path,CancellationToken ct)
        {
            QqqGexCalculationRunner.ValidateQuery(path);
            using var job=await ModuleJobs.AcquireAsync(profile,app.Id,ct,readOnly:true);
            using var asset=await ModuleAssets.TryOpenAsync(profile,app.Id,"engine/query.mjs",installer,ct)??throw new InvalidDataException("Missing signed GEX model.");
            return await QqqGexCalculationRunner.RunVerifiedModelAsync(node,await asset.MaterializeScriptAsync(ct),profile,"query.mjs",path,ct);
        }
        var api=new PrivateAppOperations(profile,app.Id,dispatcher,false,installer);
        await using var session=new QqqGexAppSession(Path.Combine(profile,"cache","qqq-gex.db"),"local",null,null,api,null,installer,Query);
        session.UpdatePresentation(presentation);
        await Preview(session);
    }
    else
    {
        await using var session=await PrivateAppSession.CreateAsync(profile,app.Id,dispatcher,false,installer,stop.Token);
        session.UpdatePresentation(presentation);
        await Preview(session);
    }
    return 0;
}
finally
{
    try{if(Directory.Exists(profile))Directory.Delete(profile,true);}catch(IOException){Console.Error.WriteLine("Temporary app files are still in use: "+profile);}
}

    }
}

sealed class DevDispatcher(string directory,ModuleInstaller installer,string node):IOperationDispatcher
{
    private readonly AutomationService host=new(new(directory,DataDirectorySource.CommandLine));
    public DataDirectoryInfo DirectoryInfo=>new(directory,DataDirectorySource.CommandLine);
    public async Task<IOperationCatalog> GetCatalogAsync(CancellationToken ct=default){var snapshot=await ModuleOperations.ReadSnapshotAsync(directory,installer,ct);return ModuleOperations.Merge(snapshot.Operations,snapshot.Issues);}
    public async Task<JsonElement> ExecuteAsync(string name,JsonElement arguments,bool allowWrites,CancellationToken ct=default)
    {
        if(allowWrites)throw new UnauthorizedAccessException("Development host is read-only.");
        var operation=(await ModuleOperations.ReadAsync(directory,installer,ct)).SingleOrDefault(o=>o.Definition.Name==name)??throw new ArgumentException("Unknown app operation.");
        OperationCatalog.Validate(new(operation.Definition.Name,operation.Definition.Description,operation.Definition.Writes,operation.Definition.Schema),arguments);
        using var hostSession=host.BeginModuleHostSession();
        return WireJson.Element(WireJson.Success(await ModuleProcess.ExecuteAsync(directory,operation,arguments,false,installer,_=>Task.FromResult<string?>(node),ct,hostSession.InvokeAsync)));
    }
    internal async Task SeedAsync(string inputFile,CancellationToken ct)
    {
        var operations=await ModuleOperations.ReadAsync(directory,installer,ct);
        var operation=operations.SingleOrDefault(item=>item.AppId==ModuleAccess.QqqGex&&item.Definition.Name=="calculate_qqq_gex_local")??throw new ArgumentException("This app does not support normalized GEX input.");
        byte[] bytes;
        await using(var stream=new FileStream(inputFile,FileMode.Open,FileAccess.Read,FileShare.Read|FileShare.Delete))
        {
            if(stream.Length is <1 or >128*1024*1024)throw new ArgumentException("Development seed exceeds 128 MiB.");
            bytes=new byte[(int)stream.Length];await stream.ReadExactlyAsync(bytes,ct);
        }
        var body=new UTF8Encoding(false,true).GetString(bytes).TrimStart('\uFEFF');
        using var document=JsonDocument.Parse(body,new JsonDocumentOptions{MaxDepth=64});
        new SnapshotFile(Path.Combine(directory,"cache","qqq-gex-input.json"),128*1024*1024).Write(body);
        using var hostSession=host.BeginModuleHostSession();
        var result=await ModuleProcess.ExecuteAsync(directory,operation,JsonSerializer.SerializeToElement(new{}),true,installer,_=>Task.FromResult<string?>(node),ct,hostSession.InvokeAsync);
        var status=result.GetProperty("status").GetString();
        if(status is not ("imported" or "partial"))throw new InvalidDataException("Normalized development input was not imported.");
        Console.Error.WriteLine("Temporary development seed: "+status+"; original input file unchanged.");
    }
    public void Dispose()=>host.Dispose();
}
