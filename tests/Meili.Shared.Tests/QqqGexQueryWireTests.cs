using System.Text;
using System.Text.Json;
using Meili.Shared.Services;
namespace Meili.Shared.Tests;
public sealed class QqqGexQueryWireTests
{
    [Fact]
    public void Large_query_response_retains_canonical_node_bytes_and_owned_data()
    {
        var text="{\"source\":\"CBOE · 延迟 <15> & partial\",\"value\":1e-7,\"missing\":null,\"rows\":["+string.Join(",",Enumerable.Repeat("{\"strike\":600.5,\"note\":\"缺失 IV\"}",20000))+"]}";
        JsonElement owned;using(var document=JsonDocument.Parse(text))owned=document.RootElement.Clone();
        var actual=QqqGexSession.SerializeQuery(owned);
        Assert.Equal(Encoding.UTF8.GetBytes(text),actual);
        using var roundtrip=JsonDocument.Parse(actual);Assert.Equal(20000,roundtrip.RootElement.GetProperty("rows").GetArrayLength());Assert.Equal(JsonValueKind.Null,roundtrip.RootElement.GetProperty("missing").ValueKind);
    }
}
