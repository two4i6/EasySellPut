using Meili.Data.Cache;
using Microsoft.Data.Sqlite;
using System.Text;
using System.Text.Json;
using System.Security.Cryptography;
namespace Meili.Data.Tests;
public sealed class QqqGexCompressionTests
{
    static byte[] ReadShared(string path){using var file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete);using var bytes=new MemoryStream();file.CopyTo(bytes);return bytes.ToArray();}
    static string Hash(string text)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    [Fact] public void Display_poll_clocks_do_not_duplicate_unchanged_evidence_but_prices_and_model_time_do()
    {
        var directory=Path.Combine(Path.GetTempPath(),"gex-display-identity-"+Guid.NewGuid());
        var store=new QqqGexResponseStore(Path.Combine(directory,"archive.db"));
        static string Body(double price,string observed,string cutoff="2026-01-02T15:00:00Z",string source="fixture")=>JsonSerializer.Serialize(new{captures=Array.Empty<object>(),displayPrices=new{bars=new[]{new{timestamp="2026-01-02T15:00:00Z",close=price}},provenance=new{Source=source,AsOf="2026-01-02T15:02:00Z",FetchedAt=observed,observedAt=observed,requestedUntil=observed,valuationCutoff=cutoff}}});
        try
        {
            var first=Body(600,"2026-01-02T15:03:00Z");var identity=store.RecordObservedInput(first);
            Assert.Equal(identity,store.RecordObservedInput(Body(600,"2026-01-02T15:04:00Z")));
            Assert.Equal(first,store.ReadObservedInput(identity));
            Assert.NotEqual(identity,store.RecordObservedInput(Body(601,"2026-01-02T15:04:00Z")));
            Assert.NotEqual(identity,store.RecordObservedInput(Body(600,"2026-01-02T15:04:00Z","2026-01-02T15:02:00Z")));
            Assert.NotEqual(identity,store.RecordObservedInput(Body(600,"2026-01-02T15:04:00Z",source:"another-source")));
        }
        finally{store.ReleaseIdleConnections();if(Directory.Exists(directory))Directory.Delete(directory,true);}
    }
    [Fact] public void Binary_provider_and_normalized_inputs_are_lossless_compressed_and_deduplicated()
    {
        var path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".db");var store=new QqqGexResponseStore(path);var bytes=Enumerable.Range(0,100000).Select(i=>(byte)(i%256)).ToArray();var at=DateTimeOffset.UtcNow;var hash=store.RecordProviderBody("fixture",bytes,at,at);Assert.Equal(bytes,store.ReadProviderBody(hash));Assert.Equal(hash,store.RecordProviderBody("fixture",bytes,at,at));
        var first="{\"symbol\":\"QQQ\",\"captures\":[],\"receivedAt\":\"first\",\"evaluationAt\":\"first\",\"marketInputs\":{\"macro\":{\"quotes\":[{\"Symbol\":\"QQQ\",\"FetchedAt\":\"first\"}]}}}";var identity=store.RecordObservedInput(first);Assert.Equal(identity,store.RecordObservedInput(first.Replace("first","later")));Assert.Equal(first,store.ReadObservedInput(identity));
        using var c=new SqliteConnection("Data Source="+path);c.Open();using var command=c.CreateCommand();command.CommandText="SELECT count(*) FROM qqq_gex_provider_raw";Assert.Equal(1L,command.ExecuteScalar());command.CommandText="SELECT length(body) FROM qqq_gex_provider_raw";Assert.True(Convert.ToInt64(command.ExecuteScalar())<bytes.Length/4);command.CommandText="SELECT typeof(body) FROM qqq_gex_observed_inputs";Assert.Equal("blob",command.ExecuteScalar());
        command.CommandText="UPDATE qqq_gex_observed_inputs SET body=x'1F8B000000'";command.ExecuteNonQuery();Assert.ThrowsAny<Exception>(()=>store.ReadObservedInput(identity));
    }
    [Fact] public void Explicit_compaction_compresses_legacy_records_reclaims_pages_and_preserves_history()
    {
        var path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".db");var store=new QqqGexResponseStore(path);var body=JsonSerializer.Serialize(new {capturedAt="2026-01-02T14:32:00Z",expiryDate="2026-01-05",profile=Enumerable.Range(0,200).Select(i=>new{strike=500+i,callBid=0,callAsk=1,putBid=1,putAsk=2})});var sha=Hash(body);var input="{\"symbol\":\"QQQ\",\"captures\":[],\"source\":\"legacy-fixture\"}";var inputHash=Hash(input);
        using(var c=new SqliteConnection("Data Source="+path)){c.Open();using var cmd=c.CreateCommand();cmd.CommandText="CREATE TABLE qqq_gex_local_rows(row_key TEXT PRIMARY KEY,body TEXT,sha256 TEXT);INSERT INTO qqq_gex_local_rows VALUES('ref',$body,$hash)";cmd.Parameters.AddWithValue("$body",body);cmd.Parameters.AddWithValue("$hash",sha);cmd.ExecuteNonQuery();var day=JsonSerializer.Serialize(new{rows=new[]{new{capturedAt="2026-01-02T14:32:00Z",expiryDate="2026-01-05",profileRef="ref",rowSha256=sha}},bars=Array.Empty<object>()});cmd.Parameters.Clear();cmd.CommandText="INSERT INTO qqq_gex_local_days VALUES('2026-01-02','r1',$body,0);INSERT INTO qqq_gex_local_day_hashes VALUES('2026-01-02',$hash)";cmd.Parameters.AddWithValue("$body",day);cmd.Parameters.AddWithValue("$hash",Hash(day));cmd.ExecuteNonQuery();cmd.Parameters.Clear();cmd.CommandText="CREATE TABLE qqq_gex_observed_inputs(identity TEXT PRIMARY KEY,received_at INTEGER,body_sha256 TEXT,body TEXT);CREATE TABLE qqq_gex_raw(sha256 TEXT PRIMARY KEY,source TEXT,received_at INTEGER,body TEXT);INSERT INTO qqq_gex_observed_inputs VALUES('legacy',0,$hash,$body);INSERT INTO qqq_gex_raw VALUES($hash,'fixture',0,$body)";cmd.Parameters.AddWithValue("$body",input);cmd.Parameters.AddWithValue("$hash",inputHash);cmd.ExecuteNonQuery();}
        const string route="/api/analysis/qqq/gex/day?from=2026-01-02T14:30:00Z&to=2026-01-02T14:35:00Z";var original=store.ReadLocalDay(route,DateTimeOffset.UtcNow)!.Body;for(var i=0;i<8;i++)store.Save("local","/api/analysis/qqq/pcs?test="+i,new("application/json",new string('x',1000000),"fixture",DateTimeOffset.UtcNow,DateTimeOffset.MaxValue));store.Clear(false);var compact=store.Compact();Assert.True(compact.Compacted);Assert.Equal(0,compact.Removed);Assert.True(compact.ReclaimedBytes>1000000);Assert.Equal(original,new QqqGexResponseStore(path).ReadLocalDay(route,DateTimeOffset.UtcNow)!.Body);Assert.Equal(input,store.ReadObservedInput("legacy"));using var check=new SqliteConnection("Data Source="+path);check.Open();using var command=check.CreateCommand();command.CommandText="SELECT body FROM qqq_gex_raw";Assert.Equal("@observed-v1:legacy",command.ExecuteScalar());command.CommandText="PRAGMA auto_vacuum";Assert.Equal(2L,command.ExecuteScalar());
    }
    [Fact] public void Space_reserve_refuses_new_writes_without_deleting_history()
    {Assert.Throws<IOException>(()=>QqqGexStoragePolicy.EnsureAvailable(QqqGexStoragePolicy.ReserveBytes,1));QqqGexStoragePolicy.EnsureAvailable(QqqGexStoragePolicy.ReserveBytes+2,1);}
    [Fact] public void Corrupt_database_health_pauses_writes_without_resetting_original_file()
    {
        var path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".db");var store=new QqqGexResponseStore(path);SqliteConnection.ClearAllPools();var bytes=Encoding.UTF8.GetBytes("retained corrupt source fixture");File.WriteAllBytes(path,bytes);
        using var result=JsonSerializer.SerializeToDocument(store.StorageHealth());Assert.False(result.RootElement.GetProperty("canCapture").GetBoolean());Assert.Equal("storage_unavailable",result.RootElement.GetProperty("error").GetString());Assert.Equal(bytes,ReadShared(path));var reopened=new QqqGexResponseStore(path);Assert.True(reopened.IsUnavailable);Assert.False(reopened.Inspect().CanClear);Assert.Equal(bytes,ReadShared(path));
    }
}
