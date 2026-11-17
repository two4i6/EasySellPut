using System.Text.Json;
using Meili.Automation;
using Meili.Automation.Modules;
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
    if(!args[i].StartsWith("--",StringComparison.Ordinal)||i+1>=args.Length||!options.TryAdd(args[i][2..],args[++i]))throw new ArgumentException("Use --package PATH --public-key PATH --repository OWNER/REPO [--node PATH] [--operation NAME] [--input PATH].");
}
if(options.Keys.Any(k=>k is not("package" or "public-key" or "repository" or "node" or "operation" or "input")))throw new ArgumentException("Unsupported development option; production data directories are never accepted.");
foreach(var required in new[]{"package","public-key","repository"})if(!options.ContainsKey(required))throw new ArgumentException("Missing --"+required);
var publicFile=new FileInfo(options["public-key"]);if(publicFile.Length>8192)throw new InvalidDataException("Oversized development public key.");
var key=await File.ReadAllTextAsync(publicFile.FullName);var repository=options["repository"];if(!UpdateClient.IsValidRepository(repository))throw new ArgumentException("Invalid development repository.");
var node=options.GetValueOrDefault("node","node");
var profile=Path.Combine(Path.GetTempPath(),"EasySellPut-AppDev-"+Guid.NewGuid().ToString("N"));
using var stop=new CancellationTokenSource();Console.CancelKeyPress+=(_,e)=>{e.Cancel=true;stop.Cancel();};
try
{
    var installer=new ModuleInstaller(profile,(archive,ct)=>ModulePackage.VerifyAsync(archive,key,repository,UpdateClient.RuntimeId,ct));
    await installer.InstallAsync(options["package"],stop.Token);
    using var dispatcher=new DevDispatcher(profile,installer,node);var app=installer.Inspect().State.Apps.Single();
    if(options.TryGetValue("operation",out var operation))
    {
        if(options.TryGetValue("input",out var inputFile)&&new FileInfo(inputFile).Length>1048576)throw new ArgumentException("Development input exceeds 1 MiB.");
        using var arguments=JsonDocument.Parse(options.TryGetValue("input",out var input)?await File.ReadAllTextAsync(input,stop.Token):"{}",new JsonDocumentOptions{MaxDepth=16});
        Console.WriteLine((await dispatcher.ExecuteAsync(operation,arguments.RootElement,false,stop.Token)).GetRawText());return 0;
    }
    await using var session=await PrivateAppSession.CreateAsync(profile,app.Id,dispatcher,false,installer,stop.Token);
    Console.WriteLine(WireJson.Element(new{development=true,readOnly=true,temporaryProfile=profile,page=session.PageUri.AbsoluteUri}).GetRawText());
    Console.Error.WriteLine("Development preview only. Open the private URL; Enter/EOF or Ctrl+C stops it. No existing user profile is loaded.");
    try{await Console.In.ReadLineAsync(stop.Token);}catch(OperationCanceledException){}
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
    public async Task<IOperationCatalog> GetCatalogAsync(CancellationToken ct=default)=>ModuleOperations.Merge(await ModuleOperations.ReadAsync(directory,installer,ct));
    public async Task<JsonElement> ExecuteAsync(string name,JsonElement arguments,bool allowWrites,CancellationToken ct=default)
    {
        if(allowWrites)throw new UnauthorizedAccessException("Development host is read-only.");
        var operation=(await ModuleOperations.ReadAsync(directory,installer,ct)).SingleOrDefault(o=>o.Definition.Name==name)??throw new ArgumentException("Unknown app operation.");
        OperationCatalog.Validate(new(operation.Definition.Name,operation.Definition.Description,operation.Definition.Writes,operation.Definition.Schema),arguments);
        return WireJson.Element(WireJson.Success(await ModuleProcess.ExecuteAsync(directory,operation,arguments,false,installer,_=>Task.FromResult<string?>(node),ct,host.ExecuteHostOperationAsync)));
    }
    public void Dispose()=>host.Dispose();
}
