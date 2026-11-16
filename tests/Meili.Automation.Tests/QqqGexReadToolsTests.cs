using System.Text.Json;
using Meili.Automation;
using Meili.Core.Settings;
namespace Meili.Automation.Tests;
public sealed class QqqGexReadToolsTests
{
    [Fact] public async Task Read_tools_are_discoverable_without_write_permission_and_do_not_create_missing_database()
    {
        var path=Path.Combine(Path.GetTempPath(),"qqq-read-tools-"+Guid.NewGuid().ToString("N"));
        try{using var service=new AutomationService(new(path,DataDirectorySource.CommandLine));foreach(var tool in new[]{"get_qqq_gex_archive","get_qqq_gex_view"})Assert.False(OperationCatalog.Find(tool).Writes);
        foreach(var (tool,args) in new[]{("get_qqq_gex_archive","{\"resource\":\"dates\"}"),("get_qqq_gex_view","{\"resource\":\"context\",\"date\":\"2026-11-16\",\"at\":\"2026-11-16T15:00:00Z\"}")}){using var input=JsonDocument.Parse(args);var result=await service.ExecuteAsync(tool,input.RootElement,false);Assert.Equal("cache_miss",result.GetProperty("data").GetProperty("status").GetString());}
        Assert.False(File.Exists(Path.Combine(path,"cache","qqq-gex.db")));}finally{if(Directory.Exists(path))Directory.Delete(path,true);}
    }
    [Theory]
    [InlineData("{\"resource\":\"exposureManifest\",\"date\":\"2026-11-16\",\"from\":\"2026-11-16T15:00:00Z\"}")]
    [InlineData("{\"resource\":\"context\",\"date\":\"2026-11-16\",\"offset\":1}")]
    [InlineData("{\"resource\":\"exposureWindow\",\"date\":\"2026-11-16\",\"from\":\"2026-11-16T15:00:00Z\",\"to\":\"2026-11-16T17:00:00Z\",\"source\":\"revision\"}")]
    public async Task Dynamic_reads_reject_wrong_scope_unversioned_continuation_and_oversized_windows(string args)
    {
        var path=Path.Combine(Path.GetTempPath(),"qqq-read-validation-"+Guid.NewGuid().ToString("N"));try{using var service=new AutomationService(new(path,DataDirectorySource.CommandLine));using var input=JsonDocument.Parse(args);await Assert.ThrowsAsync<ArgumentException>(()=>service.ExecuteAsync("get_qqq_gex_view",input.RootElement,false));}finally{if(Directory.Exists(path))Directory.Delete(path,true);}
    }
}
