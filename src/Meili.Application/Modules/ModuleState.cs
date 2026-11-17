using System.Text.Json;
using Meili.Core.Settings;
namespace Meili.Automation.Modules;

/// <summary>Logical, read-only presentation snapshots. Never accepts a filesystem path.</summary>
internal static class ModuleState
{
    internal static string ResolvePath(string directory,string appId,string key)
    {
        ModuleRegistry.ValidateId(appId);
        if(key is not ("preferences" or "desktop" or "input"))throw new ArgumentException("Unknown application snapshot.");
        var parts=appId==ModuleAccess.QqqGex
            ?key=="input"?new[]{"cache","qqq-gex-input.json"}:new[]{key=="preferences"?"qqq-gex-view.json":"qqq-gex-desktop-state.json"}
            :new[]{"apps","data",appId,"state",key+".json"};
        var path=Path.GetFullPath(directory);
        foreach(var part in parts)
        {
            path=Path.Combine(path,part);
            if(new DirectoryInfo(path).LinkTarget is not null||new FileInfo(path).LinkTarget is not null)throw new InvalidDataException("Linked application snapshot path.");
        }
        return path;
    }
    internal static JsonElement Read(string directory,string appId,string key)
    {
        ModuleRegistry.ValidateId(appId);
        if(key is not ("preferences" or "desktop"))throw new ArgumentException("Unknown application snapshot.");
        var path=ResolvePath(directory,appId,key);
        var text=new SnapshotFile(path,key=="preferences"?65536:131072).Read();
        return WireJson.Element(WireJson.Success(new{body=text}));
    }
}
