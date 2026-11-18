using System.Buffers;
using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
namespace Meili.Data.Cache;
/// <summary>Legacy TEXT/gzip or opt-in QGEX v2 Brotli; hashes always cover original decoded bytes.</summary>
internal static class QqqGexArchiveBody
{
    const int HeaderBytes=48, MaximumBytes=128*1024*1024;
    internal static string WriteCodec(string? codec=null)
    {
        codec??=Environment.GetEnvironmentVariable("MEILI_GEX_ARCHIVE_CODEC")??"gzip-v1";
        return codec is "gzip-v1" or "brotli-v2"?codec:throw new InvalidDataException("Unsupported GEX write codec");
    }
    internal static string EncodingOf(byte[] bytes)=>bytes.AsSpan().StartsWith("QGEX"u8)?"brotli-v2":"gzip-v1";
    internal static byte[] Encode(ReadOnlySpan<byte> body,string? codec=null)
    {
        if(body.Length>MaximumBytes)throw new InvalidDataException("GEX archive exceeds decoded limit");
        if(WriteCodec(codec)=="gzip-v1"){using var output=new MemoryStream();using(var gzip=new GZipStream(output,CompressionLevel.Fastest,true))gzip.Write(body);return output.ToArray();}
        var compressed=new byte[BrotliEncoder.GetMaxCompressedLength(body.Length)];
        if(!BrotliEncoder.TryCompress(body,compressed,out var count,quality:4,window:22))throw new InvalidDataException("GEX archive compression failed");
        var encoded=new byte[HeaderBytes+count];"QGEX"u8.CopyTo(encoded);encoded[4]=2;encoded[5]=1;
        BinaryPrimitives.WriteUInt32LittleEndian(encoded.AsSpan(8),(uint)body.Length);
        BinaryPrimitives.WriteUInt32LittleEndian(encoded.AsSpan(12),(uint)count);
        SHA256.HashData(body).CopyTo(encoded,16);compressed.AsSpan(0,count).CopyTo(encoded.AsSpan(HeaderBytes));return encoded;
    }
    internal static string Decode(object value,int maximumBytes)=>Encoding.UTF8.GetString(DecodeBytes(value,maximumBytes));
    internal static byte[] DecodeBytes(object value,int maximumBytes)
    {
        if(maximumBytes<0||maximumBytes>MaximumBytes)throw new InvalidDataException("Invalid GEX archive decoded limit");
        if(value is string text){if(Encoding.UTF8.GetByteCount(text)>maximumBytes)throw new InvalidDataException("GEX archive exceeds decoded limit");return Encoding.UTF8.GetBytes(text);}
        if(value is not byte[] bytes)throw new InvalidDataException("Unsupported GEX archive encoding");
        if(bytes.AsSpan().StartsWith("QGEX"u8))
        {
            if(bytes.Length<HeaderBytes||bytes.Length>(long)maximumBytes+65536+HeaderBytes||bytes[4]!=2||bytes[5]!=1||bytes[6]!=0||bytes[7]!=0)throw new InvalidDataException("Invalid GEX v2 archive header");
            var length=BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(8));var compressedLength=BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(12));
            if(length>maximumBytes||compressedLength!=bytes.Length-HeaderBytes)throw new InvalidDataException("GEX v2 archive length mismatch");
            var output=new byte[(int)length+1];using var decoder=new BrotliDecoder();
            var status=decoder.Decompress(bytes.AsSpan(HeaderBytes),output,out var consumed,out var written);
            if(status!=OperationStatus.Done||consumed!=compressedLength||written!=length||!CryptographicOperations.FixedTimeEquals(SHA256.HashData(output.AsSpan(0,written)),bytes.AsSpan(16,32)))throw new InvalidDataException("GEX v2 archive integrity failed");
            return output.AsSpan(0,written).ToArray();
        }
        if(bytes.Length>(long)maximumBytes+65536||bytes.Length<2||bytes[0]!=31||bytes[1]!=139)throw new InvalidDataException("Unsupported GEX archive encoding");
        using var input=new MemoryStream(bytes,false);using var gzip=new GZipStream(input,CompressionMode.Decompress);using var decoded=new MemoryStream();var buffer=new byte[32768];int count;
        while((count=gzip.Read(buffer))>0){if(decoded.Length+count>maximumBytes)throw new InvalidDataException("GEX archive exceeds decoded limit");decoded.Write(buffer,0,count);}return decoded.ToArray();
    }
}
public static class QqqGexStoragePolicy
{
    public const long WireLimitBytes=64L*1024*1024;
    public const long ArchiveWarningBytes=1024L*1024*1024;
    public const long ReserveBytes=256L*1024*1024;
    public static void EnsureAvailable(long availableBytes,long incomingBytes){if(availableBytes<ReserveBytes+checked(incomingBytes*2))throw new IOException("QQQ GEX storage reserve reached; existing history preserved, capture/import paused");}
}
