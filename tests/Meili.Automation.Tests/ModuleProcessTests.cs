using System.Text.Json;
using Meili.Automation.Modules;
namespace Meili.Automation.Tests;

public sealed class ModuleProcessTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "esp-module-process-" + Guid.NewGuid().ToString("N"));
    private string Script(string body)
    {
        Directory.CreateDirectory(root); var path = Path.Combine(root, Guid.NewGuid().ToString("N") + ".mjs"); File.WriteAllText(path, body); return path;
    }
    [Fact]
    public async Task Fixed_process_boundary_runs_two_app_versions_and_preserves_exact_observation_values()
    {
        var input = new { source = "fixture", asOf = "2026-01-02T16:00:00Z", price = 123.4567 };
        foreach (var version in new[] { "A", "B" })
        {
            var script = Script("let body='';for await(const c of process.stdin)body+=c;const input=JSON.parse(body);process.stdout.write(JSON.stringify({version:'"+version+"',...input}));");
            var result = await ModuleProcess.RunAsync("node", script, input, CancellationToken.None);
            Assert.Equal(version, result.GetProperty("version").GetString());
            Assert.Equal(input.price, result.GetProperty("price").GetDouble());
            Assert.Equal(input.asOf, result.GetProperty("asOf").GetString());
        }
    }
    [Fact]
    public async Task Cancellation_terminates_engine_without_waiting_for_its_own_timeout()
    {
        var script = Script("process.stdin.resume();setInterval(()=>{},1000);");
        using var stop = new CancellationTokenSource(TimeSpan.FromMilliseconds(250));
        var watch = System.Diagnostics.Stopwatch.StartNew();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => ModuleProcess.RunAsync("node", script, new { }, stop.Token));
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(10));
    }
    [Fact]
    public async Task Invalid_and_excessive_output_fail_closed()
    {
        await Assert.ThrowsAnyAsync<JsonException>(() => ModuleProcess.RunAsync("node", Script("process.stdout.write('not JSON');"), new { }, CancellationToken.None));
        var error = await Record.ExceptionAsync(() => ModuleProcess.RunAsync("node", Script("process.stdout.write('x'.repeat(17*1024*1024));"), new { }, CancellationToken.None));
        Assert.True(error is InvalidDataException or OperationCanceledException, error?.ToString());
    }
    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }
}
