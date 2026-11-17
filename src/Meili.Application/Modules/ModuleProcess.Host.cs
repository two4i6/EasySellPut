using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Meili.Core.Diagnostics;
namespace Meili.Automation.Modules;

public static partial class ModuleProcess
{
    internal static async Task<JsonElement> RunHostAsync(string executable,string script,object request,IReadOnlyList<string> declared,
        Func<string,JsonElement,CancellationToken,Task<JsonElement>> hostCall,CancellationToken ct)
    {
        var input=JsonSerializer.SerializeToUtf8Bytes(request,WireJson.Options);
        if(input.Length>1048576)throw new ArgumentException("Application request exceeds bound.");
        var start=new ProcessStartInfo(executable){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true};
        start.ArgumentList.Add(script);start.Environment.Remove("NODE_OPTIONS");start.Environment.Remove("NODE_PATH");start.Environment.Remove("NODE_ICU_DATA");
        using var deadline=CancellationTokenSource.CreateLinkedTokenSource(ct);deadline.CancelAfter(TimeSpan.FromMinutes(2));
        using var process=Process.Start(start)??throw new IOException("Cannot start app engine.");
        var token=deadline.Token;
        async Task DrainErrors()
        {
            var buffer=new byte[8192];var total=0;int read;
            while((read=await process.StandardError.BaseStream.ReadAsync(buffer,token).ConfigureAwait(false))>0)
                if((total+=read)>65536){deadline.Cancel();throw new InvalidDataException("Application diagnostics exceed bound.");}
        }
        var errors=DrainErrors();var reader=new Frames(process.StandardOutput.BaseStream);
        async Task Send(object frame)
        {
            var bytes=JsonSerializer.SerializeToUtf8Bytes(frame,WireJson.Options);
            if(bytes.Length>16*1024*1024)throw new InvalidDataException("Host result exceeds bound.");
            await process.StandardInput.BaseStream.WriteAsync(bytes,token).ConfigureAwait(false);
            await process.StandardInput.BaseStream.WriteAsync(new byte[]{10},token).ConfigureAwait(false);
            await process.StandardInput.BaseStream.FlushAsync(token).ConfigureAwait(false);
        }
        try
        {
            await Send(request).ConfigureAwait(false);var nextId=1;
            while(true)
            {
                using var frame=JsonDocument.Parse(await reader.ReadAsync(token).ConfigureAwait(false),new JsonDocumentOptions{MaxDepth=64});
                ModulePackage.RejectDuplicates(frame.RootElement);var value=frame.RootElement;
                if(value.ValueKind!=JsonValueKind.Object||!value.TryGetProperty("type",out var kind))throw new InvalidDataException("Invalid application host frame.");
                if(kind.GetString()=="result")
                {
                    if(value.EnumerateObject().Count()!=2||!value.TryGetProperty("result",out var result))throw new InvalidDataException("Invalid application result.");
                    var owned=DecodeResult(result);process.StandardInput.Close();
                    // A result must be the last frame; trailing output is not silently accepted.
                    if(await reader.HasMoreAsync(token).ConfigureAwait(false))throw new InvalidDataException("Unexpected trailing application output.");
                    await process.WaitForExitAsync(token).ConfigureAwait(false);await errors.ConfigureAwait(false);
                    if(process.ExitCode!=0)throw new InvalidDataException("Application engine failed after its result.");
                    return owned;
                }
                if(kind.GetString()!="hostCall"||value.EnumerateObject().Count()!=4||!value.TryGetProperty("id",out var identity)||!identity.TryGetInt32(out var id)||id!=nextId++||id>256||
                    !value.TryGetProperty("operation",out var operation)||operation.ValueKind!=JsonValueKind.String||!value.TryGetProperty("arguments",out var arguments)||arguments.ValueKind!=JsonValueKind.Object||
                    !declared.Contains(operation.GetString(),StringComparer.Ordinal))throw new UnauthorizedAccessException("Undeclared or malformed application host call.");
                var definition=ModuleHostOperations.Definition(operation.GetString()!);
                JsonElement reply;
                try{OperationCatalog.Validate(definition,arguments);reply=await hostCall(definition.Name,arguments,token).ConfigureAwait(false);}
                catch(Exception ex)when(ex is ArgumentException or JsonException or IOException or InvalidDataException or HttpRequestException or InvalidOperationException or UnauthorizedAccessException)
                {reply=WireJson.Element(WireJson.Error(ex));} // expected: typed host errors are returned to app without financial-argument logging.
                await Send(new{type="hostResult",id,result=reply}).ConfigureAwait(false);
            }
        }
        finally
        {
            if(!process.HasExited)try{process.Kill(true);}catch(InvalidOperationException){}
            deadline.Cancel();
            try{await errors.ConfigureAwait(false);}catch(Exception ex)when(ex is IOException or OperationCanceledException or InvalidDataException)
            {if(ex is not OperationCanceledException)AppLog.Warn("apps","Host-call diagnostics ended",ex);}
        }
    }
    private sealed class Frames(Stream stream)
    {
        private readonly byte[] buffer=new byte[16384];private int offset,count;private long total;
        public async Task<byte[]> ReadAsync(CancellationToken ct)
        {
            using var body=new MemoryStream();
            while(true)
            {
                if(offset==count){count=await stream.ReadAsync(buffer,ct).ConfigureAwait(false);offset=0;if(count==0)throw new InvalidDataException("Application closed without a complete frame.");}
                var end=Array.IndexOf(buffer,(byte)10,offset,count-offset);var length=(end<0?count:end)-offset;
                if(body.Length+length>16*1024*1024||(total+=length+1)>64*1024*1024)throw new InvalidDataException("Application host output exceeds bound.");
                body.Write(buffer,offset,length);offset+=length;
                if(end>=0){offset++;return body.ToArray();}
            }
        }
        public async Task<bool> HasMoreAsync(CancellationToken ct)=>offset<count||await stream.ReadAsync(buffer.AsMemory(0,1),ct).ConfigureAwait(false)>0;
    }
}
