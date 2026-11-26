using System.IO.Compression;
using System.Text;
namespace Meili.Data.Cache;
/// <summary>Lossless v1 archive encoding: legacy TEXT or bounded gzip BLOB. Hashes cover decoded bytes.</summary>
internal static class QqqGexArchiveBody
{
    internal static byte[] Encode(ReadOnlySpan<byte> body){using var output=new MemoryStream();using(var gzip=new GZipStream(output,CompressionLevel.Fastest,true))gzip.Write(body);return output.ToArray();}
    internal static string Decode(object value,int maximumBytes)=>Encoding.UTF8.GetString(DecodeBytes(value,maximumBytes));
    internal static byte[] DecodeBytes(object value,int maximumBytes)
    {
        if(value is string text){if(Encoding.UTF8.GetByteCount(text)>maximumBytes)throw new InvalidDataException("GEX archive exceeds decoded limit");return Encoding.UTF8.GetBytes(text);}
        if(value is not byte[] bytes||bytes.Length>maximumBytes||bytes.Length<2||bytes[0]!=31||bytes[1]!=139)throw new InvalidDataException("Unsupported GEX archive encoding");
        using var input=new MemoryStream(bytes,false);using var gzip=new GZipStream(input,CompressionMode.Decompress);using var output=new MemoryStream();var buffer=new byte[32768];int count;while((count=gzip.Read(buffer))>0){if(output.Length+count>maximumBytes)throw new InvalidDataException("GEX archive exceeds decoded limit");output.Write(buffer,0,count);}return output.ToArray();
    }
}
public static class QqqGexStoragePolicy
{
    public const long WireLimitBytes=64L*1024*1024;
    public const long ArchiveWarningBytes=1024L*1024*1024;
    public const long ReserveBytes=256L*1024*1024;
    public static void EnsureAvailable(long availableBytes,long incomingBytes){if(availableBytes<ReserveBytes+checked(incomingBytes*2))throw new IOException("QQQ GEX storage reserve reached; existing history preserved, capture/import paused");}
}
