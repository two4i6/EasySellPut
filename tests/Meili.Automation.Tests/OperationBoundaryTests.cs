using System.Text.Json;
using Meili.Automation;
using Meili.Core.Settings;

namespace Meili.Automation.Tests;

public sealed class OperationBoundaryTests
{
    [Fact]
    public void Snapshot_owns_schema_lifetime_and_preserves_discovery_order()
    {
        OperationSnapshot snapshot;
        using (var document = JsonDocument.Parse("{\"type\":\"object\",\"properties\":{},\"required\":[],\"additionalProperties\":false}"))
        {
            var source = new List<Operation> { new("second", "Read", false, document.RootElement), new("first", "Write", true, document.RootElement) };
            snapshot = new(source);
            source.Clear();
        }
        Assert.Equal(new[] { "second", "first" }, snapshot.All.Select(o => o.Name));
        Assert.Equal("object", snapshot.Find("second").Schema.GetProperty("type").GetString());
        Assert.True(snapshot.Find("first").Writes);
        Assert.Throws<NotSupportedException>(() => ((IList<Operation>)snapshot.All).Clear());
        Assert.Throws<ArgumentException>(() => snapshot.Find("missing"));
    }

    [Fact]
    public void Duplicate_definitions_cannot_shadow_permission_or_handler_identity()
    {
        var op = OperationCatalog.All[0];
        Assert.Throws<ArgumentException>(() => new OperationSnapshot(new[] { op, op with { Writes = !op.Writes } }));
    }

    [Fact]
    public async Task Dispatcher_discovery_and_invocation_preserve_contracts_and_permissions()
    {
        using var service = new AutomationService(new DataDirectoryInfo(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")), DataDirectorySource.CommandLine));
        IOperationDispatcher dispatcher = service;
        Assert.Equal(OperationCatalog.All.Select(o => o.Name), dispatcher.Catalog.All.Select(o => o.Name));
        foreach (var original in OperationCatalog.All)
        {
            var actual = dispatcher.Catalog.Find(original.Name);
            Assert.Equal(original.Writes, actual.Writes);
            Assert.Equal(original.Schema.GetRawText(), actual.Schema.GetRawText());
        }
        var args = WireJson.Element(new { name = "not written" });
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => dispatcher.ExecuteAsync("create_watchlist_group", args, false));
        using var stop = new CancellationTokenSource(); stop.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => dispatcher.ExecuteAsync("get_settings", WireJson.Element(new { }), false, stop.Token));
        Assert.False(Directory.Exists(dispatcher.DirectoryInfo.Path));
    }
}
