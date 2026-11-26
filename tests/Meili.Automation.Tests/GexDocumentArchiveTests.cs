using System.Text.Json;
using Meili.Automation.Apps.QqqGex;

namespace Meili.Automation.Tests;

public sealed class GexDocumentArchiveTests
{
    [Theory]
    [InlineData("resource=dates&archiveState=partial", true)]
    [InlineData("resource=dates&archiveState=partial", false)]
    [InlineData("resource=extendedBars&date=2026-01-02&priceBasis=display", true)]
    [InlineData("resource=extendedBars&date=2026-01-02&priceBasis=display", false)]
    public async Task Shared_document_forwards_archive_queries_and_preserves_missingness(string query, bool available)
    {
        var directory = Path.Combine(Path.GetTempPath(), "gex-archive-route-" + Guid.NewGuid());
        var expected = "/api/analysis/qqq/local-archive?" + query;
        var calls = new List<string>();
        try
        {
            await using var session = new QqqGexAppSession(Path.Combine(directory, "cache", "qqq-gex.db"), "local", null, null, null, null, null,
                (route, ct) => { calls.Add(route); return Task.FromResult<object>(new { available, complete = false, items = Array.Empty<object>(), status = available ? "ok" : "cache_miss" }); });
            using var http = new HttpClient();
            using var response = await http.GetAsync(new Uri(session.PageUri, expected.TrimStart('/')));
            Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode);
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Assert.Equal(available, body.RootElement.GetProperty("available").GetBoolean());
            Assert.False(body.RootElement.GetProperty("complete").GetBoolean());
            Assert.Empty(body.RootElement.GetProperty("items").EnumerateArray());
            Assert.Equal(new[] { expected }, calls);
            using var foreign = await http.GetAsync(new Uri(session.PageUri, "api/foreign"));
            Assert.Equal(System.Net.HttpStatusCode.NotFound, foreign.StatusCode);
            Assert.Single(calls);
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
