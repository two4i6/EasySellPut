using Meili.Data.Cache;
using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
namespace Meili.Data.Tests;
public sealed class QqqGexCodecV2Tests
{
    [Fact] public void Binary_empty_and_unicode_v2_preserve_original_bytes_and_legacy_reads()
    {
        foreach(var bytes in new[]{Array.Empty<byte>(),Encoding.UTF8.GetBytes("{\"price\":600.0000000000001,\"time\":\"2026-01-02T14:32:00Z\",\"text\":\"中文\"}"),Enumerable.Range(0,65536).Select(i=>(byte)i).ToArray()})
        {
            var encoded=QqqGexArchiveBody.Encode(bytes,"brotli-v2");Assert.Equal("brotli-v2",QqqGexArchiveBody.EncodingOf(encoded));
            Assert.Equal(bytes,QqqGexArchiveBody.DecodeBytes(encoded,bytes.Length));
            if(bytes.Length>0)Assert.Equal(bytes,QqqGexArchiveBody.DecodeBytes(QqqGexArchiveBody.Encode(bytes,"gzip-v1"),128*1024*1024));
        }
        Assert.Equal("legacy 中文",QqqGexArchiveBody.Decode("legacy 中文",128));
        Assert.Throws<InvalidDataException>(()=>QqqGexArchiveBody.Encode("x"u8,"unknown"));
    }
    [Fact] public void Envelope_corruption_wrong_version_hash_length_truncation_and_trailing_bytes_fail()
    {
        var raw=Encoding.UTF8.GetBytes(new string('x',10000));var encoded=QqqGexArchiveBody.Encode(raw,"brotli-v2");
        foreach(var position in new[]{0,4,5,6,7,8,12,16,47,48,encoded.Length-1})
        {
            var corrupt=encoded.ToArray();corrupt[position]^=0x40;Assert.ThrowsAny<Exception>(()=>QqqGexArchiveBody.DecodeBytes(corrupt,128*1024*1024));
        }
        Assert.ThrowsAny<Exception>(()=>QqqGexArchiveBody.DecodeBytes(encoded[..^1],128*1024*1024));
        Assert.ThrowsAny<Exception>(()=>QqqGexArchiveBody.DecodeBytes(encoded,raw.Length-1));
        var trailing=encoded.Concat(new byte[]{1}).ToArray();BinaryPrimitives.WriteUInt32LittleEndian(trailing.AsSpan(12),(uint)(trailing.Length-48));
        Assert.ThrowsAny<Exception>(()=>QqqGexArchiveBody.DecodeBytes(trailing,128*1024*1024));
        var forged=encoded.ToArray();BinaryPrimitives.WriteUInt32LittleEndian(forged.AsSpan(8),uint.MaxValue);
        Assert.ThrowsAny<Exception>(()=>QqqGexArchiveBody.DecodeBytes(forged,128*1024*1024));
    }
    [Fact] public void Actual_store_reads_mixed_v2_observed_provider_and_legacy_without_rewriting()
    {
        var directory=Path.Combine(Path.GetTempPath(),"gex-codec-v2-"+Guid.NewGuid());Directory.CreateDirectory(directory);var path=Path.Combine(directory,"archive.db");var store=new QqqGexResponseStore(path);
        try
        {
            var body="{\"symbol\":\"QQQ\",\"source\":\"synthetic\",\"captures\":[]}";var identity=store.RecordObservedInput(body);
            var binary=Enumerable.Range(0,10000).Select(i=>(byte)i).ToArray();var at=DateTimeOffset.UtcNow;var hash=store.RecordProviderBody("synthetic",binary,at,at);
            using(var c=new Microsoft.Data.Sqlite.SqliteConnection("Data Source="+path))
            {
                c.Open();using var command=c.CreateCommand();command.CommandText="UPDATE qqq_gex_observed_inputs SET body=$body WHERE identity=$id";command.Parameters.AddWithValue("$body",QqqGexArchiveBody.Encode(Encoding.UTF8.GetBytes(body),"brotli-v2"));command.Parameters.AddWithValue("$id",identity);command.ExecuteNonQuery();
                command.Parameters.Clear();command.CommandText="UPDATE qqq_gex_provider_raw SET body=$body,encoding='brotli-v2' WHERE sha256=$id";command.Parameters.AddWithValue("$body",QqqGexArchiveBody.Encode(binary,"brotli-v2"));command.Parameters.AddWithValue("$id",hash);command.ExecuteNonQuery();
            }
            Assert.Equal(body,store.ReadObservedInput(identity));Assert.Equal(binary,store.ReadProviderBody(hash));
            using(var mismatch=new Microsoft.Data.Sqlite.SqliteConnection("Data Source="+path))
            {
                mismatch.Open();using var command=mismatch.CreateCommand();command.CommandText="UPDATE qqq_gex_provider_raw SET encoding='gzip-v1'";command.ExecuteNonQuery();
                Assert.Throws<InvalidDataException>(()=>store.ReadProviderBody(hash));
                command.CommandText="UPDATE qqq_gex_provider_raw SET encoding='brotli-v2'";command.ExecuteNonQuery();
            }
            var other=store.RecordObservedInput(body.Replace("synthetic","legacy"));Assert.Contains("legacy",store.ReadObservedInput(other));
        }
        finally{store.ReleaseIdleConnections();Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();Directory.Delete(directory,true);}
    }
}
