using System.Text.Json;
using Meili.Automation;
using Meili.Core.Settings;
using Meili.Shared.Services;
namespace Meili.Automation.Tests;
public sealed class QqqGexWorkspaceTests
{
    [Fact] public async Task Workspace_reads_persisted_UI_state_without_database_network_or_write_permission()
    {
        var dir=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"));Directory.CreateDirectory(dir);
        try{
            var prefs=new QqqGexPreferences(dir);prefs.Patch(prefs.Read().revision,new(){{"qqq-local:observed-exposure:v1","{\"cursor\":123,\"scope\":\"all\"}"},{"qqq-gex:left-tab:v1","ATM IV"},{"qqq-local:observed-interaction:v1","{\"focus\":{\"label\":\"播放速度\",\"value\":\"2\"},\"chartHover\":null}"}});
            var workspace=new QqqGexWorkspace(dir);workspace.Observe(new{ready=false,capture=new{phase="capturing",missingIv=3},quote=(object?)null});
            var before=File.ReadAllText(Path.Combine(dir,"qqq-gex-desktop-state.json"));
            using var service=new AutomationService(new(dir,DataDirectorySource.CommandLine));
            using var args=JsonDocument.Parse("{\"resource\":\"workspace\"}");
            var response=await service.ExecuteAsync("get_qqq_gex_view",args.RootElement,false);var chunk=response.GetProperty("data");
            using var body=JsonDocument.Parse(Convert.FromBase64String(chunk.GetProperty("bodyBase64").GetString()!));
            Assert.Equal("ATM IV",body.RootElement.GetProperty("preferences").GetProperty("values").GetProperty("qqq-gex:left-tab:v1").GetString());
            Assert.Equal(123,body.RootElement.GetProperty("analyticalSelections").GetProperty("exposure").GetProperty("cursor").GetInt32());
            Assert.Equal("2",body.RootElement.GetProperty("analyticalSelections").GetProperty("interaction").GetProperty("focus").GetProperty("value").GetString());
            var desktop=body.RootElement.GetProperty("desktop");Assert.True(desktop.GetProperty("fresh").GetBoolean());Assert.Equal("capturing",desktop.GetProperty("lastObserved").GetProperty("state").GetProperty("capture").GetProperty("phase").GetString());
            Assert.Equal(before,File.ReadAllText(Path.Combine(dir,"qqq-gex-desktop-state.json")));Assert.False(File.Exists(Path.Combine(dir,"cache","qqq-gex.db")));
            // A changed saved filter invalidates continuation rather than mixing snapshots.
            prefs.Patch(prefs.Read().revision,new(){{"qqq-gex:left-tab:v1","日内节奏"}});
            using var next=JsonDocument.Parse(JsonSerializer.Serialize(new{resource="workspace",offset=1,sha256=chunk.GetProperty("sha256").GetString()}));
            var changed=await service.ExecuteAsync("get_qqq_gex_view",next.RootElement,false);Assert.Equal("revision_changed",changed.GetProperty("data").GetProperty("status").GetString());
            File.WriteAllText(Path.Combine(dir,"qqq-gex-desktop-state.json"),JsonSerializer.Serialize(new{observedAt=DateTimeOffset.UtcNow.AddMinutes(-5),state=new{ready=true}}));
            var stale=JsonSerializer.SerializeToElement(workspace.Read());Assert.False(stale.GetProperty("desktop").GetProperty("fresh").GetBoolean());Assert.Equal("stale_desktop_observation",stale.GetProperty("desktop").GetProperty("status").GetString());
        }finally{Directory.Delete(dir,true);}
    }
    [Fact] public async Task Original_provider_bytes_are_lossless_chunked_readonly_and_hash_protected()
    {
        var dir=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"));Directory.CreateDirectory(dir);
        try{
            var db=Path.Combine(dir,"cache","qqq-gex.db");var source=new Meili.Data.Cache.QqqGexResponseStore(db);
            var bytes=Enumerable.Range(0,300000).Select(i=>(byte)(i%256)).ToArray();var at=DateTimeOffset.Parse("2026-01-02T15:00:00Z");var hash=source.RecordProviderBody("fixture",bytes,at,at.AddMinutes(15));
            using var service=new AutomationService(new(dir,DataDirectorySource.CommandLine));var chunks=new List<byte>();string? revision=null;var offset=0;
            do{
                using var args=JsonDocument.Parse(JsonSerializer.Serialize(new{resource="providerRaw",providerHash=hash.ToLowerInvariant(),offset,length=65536,sha256=revision??hash}));
                var response=await service.ExecuteAsync("get_qqq_gex_view",args.RootElement,false);var result=response.GetProperty("data");revision=result.GetProperty("sha256").GetString();chunks.AddRange(Convert.FromBase64String(result.GetProperty("bodyBase64").GetString()!));
                if(!result.GetProperty("hasMore").GetBoolean())break;offset=result.GetProperty("nextOffset").GetInt32();
            }while(true);
            Assert.Equal(bytes,chunks.ToArray());Assert.Equal(hash.ToLowerInvariant(),revision);
            using var wrong=JsonDocument.Parse(JsonSerializer.Serialize(new{resource="providerRaw",providerHash=hash,offset=1,sha256=new string('0',64)}));var changed=await service.ExecuteAsync("get_qqq_gex_view",wrong.RootElement,false);Assert.Equal("revision_changed",changed.GetProperty("data").GetProperty("status").GetString());
            using var invalid=JsonDocument.Parse("{\"resource\":\"providerRaw\",\"providerHash\":\"/tmp/private\"}");await Assert.ThrowsAsync<ArgumentException>(()=>service.ExecuteAsync("get_qqq_gex_view",invalid.RootElement,false));
            using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source="+db);connection.Open();using var command=connection.CreateCommand();command.CommandText="SELECT COUNT(*) FROM qqq_gex_provider_raw";Assert.Equal(1L,command.ExecuteScalar());
        }finally{Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();Directory.Delete(dir,true);}
    }
    [Theory]
    [InlineData("{\"resource\":\"workspace\",\"date\":\"2026-01-02\"}")]
    [InlineData("{\"resource\":\"workspace\",\"offset\":1}")]
    [InlineData("{\"resource\":\"analysis\",\"analysis\":\"wallTouches\",\"date\":\"2026-01-02\",\"expiry\":\"2026-01-02\",\"at\":\"2026-01-02T15:00:00Z\",\"wallHorizon\":20}")]
    [InlineData("{\"resource\":\"analysis\",\"analysis\":\"wallTouches\",\"date\":\"2026-01-02\",\"expiry\":\"2026-01-02\",\"at\":\"2026-01-02T15:00:00Z\",\"wallGamma\":\"unknown\"}")]
    [InlineData("{\"resource\":\"analysis\",\"analysis\":\"pulse\",\"date\":\"2026-01-02\",\"expiry\":\"2026-01-02\",\"at\":\"2026-01-02T15:00:00Z\",\"wallSide\":\"put\"}")]
    public async Task Scope_errors_fail_without_source_reads(string input)
    {
        var dir=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"));
        try{using var service=new AutomationService(new(dir,DataDirectorySource.CommandLine));using var args=JsonDocument.Parse(input);await Assert.ThrowsAsync<ArgumentException>(()=>service.ExecuteAsync("get_qqq_gex_view",args.RootElement,false));}
        finally{if(Directory.Exists(dir))Directory.Delete(dir,true);}
    }
}
