using System.Security.Cryptography;
using System.Text.Json;
namespace Meili.Automation.Modules;

internal sealed record ModuleMarketSnapshot(object Value,ReadOnlyMemory<byte> Raw=default);

/// <summary>Request-owned source receipts. Full provider DTOs and original bytes, never derived model inputs.</summary>
internal sealed class ModuleMarketSession(
    Func<JsonElement,CancellationToken,Task<ModuleMarketSnapshot>> open,
    Func<string,JsonElement,CancellationToken,Task<JsonElement>> fallback) : IDisposable
{
    private bool disposed;
    private string? receipt,rawReceipt;
    private byte[]? body;
    private ReadOnlyMemory<byte> raw;
    private const int Maximum=128*1024*1024;
    internal async Task<JsonElement> InvokeAsync(string name,JsonElement arguments,CancellationToken ct)
    {
        ObjectDisposedException.ThrowIf(disposed,this);
        ct.ThrowIfCancellationRequested();
        if(name=="open_market_snapshot")
        {
            ModuleMarketSnapshot source;
            using var deadline=CancellationTokenSource.CreateLinkedTokenSource(ct);
            deadline.CancelAfter(arguments.TryGetProperty("timeoutMs",out var timeout)?timeout.GetInt32():90000);
            try{source=await open(arguments,deadline.Token).ConfigureAwait(false);}
            catch(Exception ex)when(!ct.IsCancellationRequested&&(ex is ArgumentException or FormatException or InvalidDataException or JsonException or IOException or HttpRequestException or InvalidOperationException or OperationCanceledException or Meili.Data.Http.DataSourceException or Meili.Data.Routing.AllSourcesFailedException))
            {
                // expected: return bounded standard diagnostics and exception kind, never provider bodies/credentials.
                var error=WireJson.Element(WireJson.Error(ex));
                return WireJson.Element(new{success=false,error=error.GetProperty("error"),sourceException=ex.GetType().Name});
            }
            var bytes=JsonSerializer.SerializeToUtf8Bytes(source.Value,WireJson.Options);
            if(bytes.Length>Maximum||source.Raw.Length>Maximum)throw new InvalidDataException("Market snapshot exceeds bound.");
            body=bytes;raw=source.Raw;receipt=Guid.NewGuid().ToString("N");rawReceipt=raw.IsEmpty?null:Guid.NewGuid().ToString("N");
            return WireJson.Element(WireJson.Success(new{receipt,size=body.Length,sha256=Convert.ToHexString(SHA256.HashData(body)),raw=rawReceipt is null?null:new{receipt=rawReceipt,size=raw.Length,sha256=Convert.ToHexString(SHA256.HashData(raw.Span))}}));
        }
        if(name=="read_market_snapshot")
        {
            var identity=arguments.GetProperty("receipt").GetString();
            ReadOnlyMemory<byte> bytes=identity==receipt&&body is not null?body:identity==rawReceipt&&rawReceipt is not null?raw:throw new ArgumentException("Market snapshot receipt expired or belongs to another request.");
            var offset=arguments.GetProperty("offset").GetInt32();var length=arguments.TryGetProperty("length",out var size)?size.GetInt32():262144;
            if(offset<0||offset>bytes.Length||length is <1 or >1048576)throw new ArgumentException("Invalid source chunk.");
            var count=Math.Min(length,bytes.Length-offset);
            return WireJson.Element(WireJson.Success(new{offset,totalBytes=bytes.Length,chunkBytes=count,bodyBase64=Convert.ToBase64String(bytes.Span.Slice(offset,count)),nextOffset=offset+count<bytes.Length?(int?)(offset+count):null}));
        }
        return await fallback(name,arguments,ct).ConfigureAwait(false);
    }
    public void Dispose(){disposed=true;body=null;raw=default;receipt=null;rawReceipt=null;}
}
