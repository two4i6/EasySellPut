using System.Text;
namespace Meili.Automation.Modules;

/// <summary>Shared bounded private-loopback framing and response security headers.</summary>
public static class PrivateHttp
{
    public static async Task<(string[] Request,Dictionary<string,string> Headers,bool Complete)> ReadHeadAsync(Stream stream,CancellationToken ct)
    {
        var raw=new List<byte>();var one=new byte[1];var complete=false;
        while(raw.Count<16384)
        {
            if(await stream.ReadAsync(one,ct).ConfigureAwait(false)==0)break;raw.Add(one[0]);
            if(raw.Count>=4&&raw[^4]==13&&raw[^3]==10&&raw[^2]==13&&raw[^1]==10){complete=true;break;}
        }
        var lines=Encoding.ASCII.GetString(raw.ToArray()).Split("\r\n");var request=lines[0].Split(' ');var headers=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
        foreach(var line in lines.Skip(1).Where(l=>l.Length>0))
        {
            var colon=line.IndexOf(':');if(colon<=0||!headers.TryAdd(line[..colon],line[(colon+1)..].Trim())){complete=false;break;}
        }
        return(request,headers,complete&&raw.Count<16384);
    }
    public static string AssetType(string route)=>Path.GetExtension(route) switch{".html"=>"text/html; charset=utf-8",".css"=>"text/css; charset=utf-8",".js" or ".mjs"=>"text/javascript; charset=utf-8",".woff2"=>"font/woff2",".woff"=>"font/woff",".svg"=>"image/svg+xml",_=>"application/octet-stream"};
    public static bool AcceptsGzip(string? value)=>value?.Split(',').Any(part=>System.Net.Http.Headers.StringWithQualityHeaderValue.TryParse(part.Trim(),out var token)&&token.Value.Equals("gzip",StringComparison.OrdinalIgnoreCase)&&(token.Quality??1)>0)==true;
    public static async Task ReplyAsync(Stream stream,int status,string type,byte[] body,CancellationToken ct,bool gzip=false,long elapsed=0)
    {
        var encoding="";
        if(gzip&&status==200&&body.Length>=16384&&(type.Contains("json",StringComparison.Ordinal)||type.Contains("javascript",StringComparison.Ordinal)||type.StartsWith("text/",StringComparison.Ordinal)))
        {using var output=new MemoryStream();using(var compressor=new System.IO.Compression.GZipStream(output,System.IO.Compression.CompressionLevel.Fastest,true))compressor.Write(body);body=output.ToArray();encoding="Content-Encoding: gzip\r\nVary: Accept-Encoding\r\n";}
        const string csp="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
        await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 {status} Response\r\nContent-Type: {type}\r\nContent-Length: {body.Length}\r\n{encoding}Server-Timing: local;dur={elapsed}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: {csp}\r\nConnection: close\r\n\r\n"),ct).ConfigureAwait(false);
        await stream.WriteAsync(body,ct).ConfigureAwait(false);
    }
}
