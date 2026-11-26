using System.Text.Json;
using Meili.Automation;
using Meili.Automation.Modules;
namespace Meili.Automation.Tests;
public sealed class OptionsAppGrantTests
{
    [Fact] public async Task Writes_are_explicit_exact_single_use_and_cannot_fake_success()
    {
        var args=WireJson.Element(new{name="original"});var calls=0;
        Task<JsonElement> Deny(string name,JsonElement value,CancellationToken ct)=>throw new UnauthorizedAccessException();
        Task<JsonElement> Apply(string name,JsonElement value,CancellationToken ct){calls++;return Task.FromResult(WireJson.Element(WireJson.Success(new{saved=true})));}
        var grant=new ModuleWriteGrant("save_strategy",args,true,Deny,Apply);
        Assert.Throws<InvalidDataException>(grant.RequireApplied);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>grant.InvokeAsync("delete_strategy",args,default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>grant.InvokeAsync("save_strategy",WireJson.Element(new{name="foreign"}),default));
        await grant.InvokeAsync("save_strategy",args,default);grant.RequireApplied();Assert.Equal(1,calls);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>grant.InvokeAsync("save_strategy",args,default));
        var reader=new ModuleWriteGrant("save_strategy",args,false,Deny,Apply);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>reader.InvokeAsync("save_strategy",args,default));Assert.Equal(1,calls);
    }
    [Theory]
    [InlineData("add_chart_drawing")]
    [InlineData("update_chart_drawing")]
    [InlineData("delete_chart_drawing")]
    [InlineData("clear_chart_drawings")]
    public async Task Chart_writes_keep_exact_single_use_and_cross_domain_boundaries(string operation)
    {
        var args=WireJson.Element(new{symbol="AAPL",revision="original"});var calls=0;
        Task<JsonElement> Deny(string n,JsonElement a,CancellationToken ct)=>throw new UnauthorizedAccessException();
        Task<JsonElement> Apply(string n,JsonElement a,CancellationToken ct){calls++;return Task.FromResult(WireJson.Element(new{written=true}));}
        var grant=new ModuleWriteGrant(operation,args,true,Deny,Apply);
        Assert.Throws<InvalidDataException>(grant.RequireApplied);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>grant.InvokeAsync("delete_strategy",args,default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>grant.InvokeAsync(operation,WireJson.Element(new{symbol="MSFT",revision="original"}),default));
        await grant.InvokeAsync(operation,args,default);grant.RequireApplied();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>grant.InvokeAsync(operation,args,default));
        var reader=new ModuleWriteGrant(operation,args,false,Deny,Apply);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>reader.InvokeAsync(operation,args,default));Assert.Equal(1,calls);
        var failed=new ModuleWriteGrant(operation,args,true,Deny,(_,_,_)=>throw new Meili.Core.Settings.DataConflictException("stale"));
        await Assert.ThrowsAsync<Meili.Core.Settings.DataConflictException>(()=>failed.InvokeAsync(operation,args,default));
        Assert.Throws<InvalidDataException>(failed.RequireApplied);
    }
    [Fact] public async Task Failed_host_write_never_becomes_an_applied_success()
    {
        var args=WireJson.Element(new{name="original"});
        var grant=new ModuleWriteGrant("save_strategy",args,true,(_,_,_)=>throw new UnauthorizedAccessException(),(_,_,_)=>throw new Meili.Core.Settings.DataConflictException("fixture"));
        await Assert.ThrowsAsync<Meili.Core.Settings.DataConflictException>(()=>grant.InvokeAsync("save_strategy",args,default));Assert.Throws<InvalidDataException>(grant.RequireApplied);
    }
    [Fact] public async Task Shared_host_sessions_cannot_invoke_writes_without_a_request_grant()
    {
        var directory=Path.Combine(Path.GetTempPath(),"s15-readonly-"+Guid.NewGuid().ToString("N"));
        using var service=new AutomationService(new(directory,Meili.Core.Settings.DataDirectorySource.CommandLine),new FakeMarket());
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>service.ExecuteHostOperationAsync("delete_strategy",WireJson.Element(new{name="x"}),default));
    }
}
