using System.Text.Json;
using Meili.Core.Settings;
namespace Meili.Automation.Modules;

/// <summary>Logical, read-only presentation snapshots. Never accepts a filesystem path.</summary>
internal static class ModuleState
{
    internal static JsonElement Read(string directory,string appId,string key)
    {
        ModuleRegistry.ValidateId(appId);
        if(key is not ("preferences" or "desktop"))throw new ArgumentException("Unknown application snapshot.");
        var path=appId==ModuleAccess.QqqGex
            ?Path.Combine(directory,key=="preferences"?"qqq-gex-view.json":"qqq-gex-desktop-state.json")
            :Path.Combine(directory,"apps","data",appId,"state",key+".json");
        var text=new SnapshotFile(path,key=="preferences"?65536:131072).Read();
        return WireJson.Element(WireJson.Success(new{body=text}));
    }
}
