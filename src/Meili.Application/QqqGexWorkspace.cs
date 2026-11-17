using System.Text.Json;
using Meili.Core.Settings;
namespace Meili.Shared.Services;

/// <summary>Read-only cross-process view of allowlisted presentation preferences and the last observed desktop state.</summary>
public sealed class QqqGexWorkspace(string directory)
{
    private string PathName=>Path.Combine(directory,"qqq-gex-desktop-state.json");
    public void Observe(object state,string? observerId=null)
    {
        var body=JsonSerializer.Serialize(new{observedAt=DateTimeOffset.UtcNow,observerId,processId=Environment.ProcessId,state});
        if(System.Text.Encoding.UTF8.GetByteCount(body)>131072)throw new InvalidDataException("GEX desktop observation exceeds bound");
        var file=new SnapshotFile(PathName);file.Read();file.Write(body);
    }
    public object Read()
    {
        JsonElement? desktop=null;string status="not_observed";bool fresh=false;
        try{
            if(File.Exists(PathName)){
                if(new FileInfo(PathName).Length>131072)throw new InvalidDataException("GEX desktop observation exceeds bound");
                using var value=JsonDocument.Parse(new SnapshotFile(PathName).Read()??throw new InvalidDataException("GEX desktop state missing"));
                var age=DateTimeOffset.UtcNow-value.RootElement.GetProperty("observedAt").GetDateTimeOffset();
                fresh=age>=TimeSpan.Zero&&age<=TimeSpan.FromSeconds(30);status=fresh?"recent_desktop_observation":"stale_desktop_observation";desktop=value.RootElement.Clone();
            }
        }catch(Exception e)when(e is IOException or JsonException or InvalidOperationException or UnauthorizedAccessException or FormatException or KeyNotFoundException){status="desktop_observation_unavailable";}
        var preferences=new QqqGexPreferences(directory).Read();var selections=new Dictionary<string,JsonElement>();
        foreach(var name in new[]{"exposure","wallTouches","spreadStudy"})if(preferences.values.TryGetValue("qqq-local:observed-"+name+":v1",out var value)){
            try{using var parsed=JsonDocument.Parse(value,new JsonDocumentOptions{MaxDepth=16});if(parsed.RootElement.ValueKind==JsonValueKind.Object)selections[name]=parsed.RootElement.Clone();}catch(JsonException){}
        }
        return new{preferences,analyticalSelections=selections,desktop=new{available=desktop.HasValue,status,fresh,lastObserved=desktop},coverage="Allowlisted persisted UI preferences and last desktop observation only. A recent observation does not certify a running/visible window or live market freshness; source timestamps remain authoritative. No network, capture, preference mutation or process control."};
    }
}
