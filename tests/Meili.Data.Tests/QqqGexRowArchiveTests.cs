using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Meili.Data.Cache;
using Microsoft.Data.Sqlite;
namespace Meili.Data.Tests;
public sealed class QqqGexRowArchiveTests
{
    private static string Hash(string body)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(body)));
    [Fact] public void Lossless_rows_rehydrate_selected_expiry_and_latest_index_survive_clear_and_reject_corruption()
    {
        var path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".db");var store=new QqqGexResponseStore(path);using var connection=new SqliteConnection("Data Source="+path);connection.Open();
        using var command=connection.CreateCommand();command.CommandText="CREATE TABLE qqq_gex_local_rows(row_key TEXT PRIMARY KEY,body TEXT,sha256 TEXT)";command.ExecuteNonQuery();
        var rows=new List<object>();foreach(var expiry in new[]{"2026-01-02","2026-01-05"}){var key="fixture|"+expiry;var body=JsonSerializer.Serialize(new {capturedAt="2026-01-02T14:32:00Z",sourceAsOf="2026-01-02T14:32:00Z",expiryDate=expiry,profile=new[]{new {strike=600,callBid=0,callAsk=1}}});var hash=Hash(body);command.CommandText="INSERT INTO qqq_gex_local_rows VALUES($key,$body,$hash)";command.Parameters.Clear();command.Parameters.AddWithValue("$key",key);command.Parameters.AddWithValue("$body",body);command.Parameters.AddWithValue("$hash",hash);command.ExecuteNonQuery();rows.Add(new {capturedAt="2026-01-02T14:32:00Z",expiryDate=expiry,profileRef=key,rowSha256=hash});}
        var day=JsonSerializer.Serialize(new{schemaVersion="qqq-local-day-v3",rows,bars=Array.Empty<object>()});command.CommandText="INSERT INTO qqq_gex_local_days VALUES('2026-01-02','r1',$body,0);INSERT INTO qqq_gex_local_day_hashes VALUES('2026-01-02',$hash)";command.Parameters.Clear();command.Parameters.AddWithValue("$body",day);command.Parameters.AddWithValue("$hash",Hash(day));command.ExecuteNonQuery();
        const string route="/api/analysis/qqq/gex/day?from=2026-01-02T14:30:00Z&to=2026-01-02T14:35:00Z";
        using(var result=JsonDocument.Parse(store.ReadLocalDay(route,DateTimeOffset.UtcNow)!.Body)){Assert.Single(result.RootElement.GetProperty("items").EnumerateArray());Assert.Equal(2,result.RootElement.GetProperty("expiries").GetArrayLength());Assert.Equal(0,result.RootElement.GetProperty("items")[0].GetProperty("profile")[0].GetProperty("callBid").GetInt32());}
        store.Clear(false);Assert.NotNull(new QqqGexResponseStore(path).ReadLocalDay(route+"&expiryDate=2026-01-05",DateTimeOffset.UtcNow));
        command.CommandText="UPDATE qqq_gex_local_rows SET body='{}',sha256=$hash";command.Parameters.Clear();command.Parameters.AddWithValue("$hash",Hash("{}"));command.ExecuteNonQuery();Assert.Throws<InvalidDataException>(()=>store.ReadLocalDay(route,DateTimeOffset.UtcNow));
    }
    [Fact] public void Lifecycle_reads_preserve_recorded_points_and_reject_cross_date_or_corrupt_bodies()
    {
        var path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".db");var store=new QqqGexResponseStore(path);const string route="/api/analysis/qqq/pcs/lifecycle?date=2026-01-02";using(var empty=JsonDocument.Parse(store.ReadLifecycle(route)!.Body))Assert.False(empty.RootElement.GetProperty("recorded").GetBoolean());
        using var connection=new SqliteConnection("Data Source="+path);connection.Open();using var command=connection.CreateCommand();command.CommandText="CREATE TABLE qqq_gex_pcs_lifecycle(day TEXT,time TEXT,body TEXT,sha256 TEXT)";command.ExecuteNonQuery();var point="{\"time\":\"2026-01-02T14:32:00Z\",\"score\":3,\"timing\":\"WAIT_CONFIRM\"}";command.CommandText="INSERT INTO qqq_gex_pcs_lifecycle VALUES('2026-01-02','2026-01-02T14:32:00Z',$body,$hash)";command.Parameters.AddWithValue("$body",point);command.Parameters.AddWithValue("$hash",Hash(point));command.ExecuteNonQuery();store.Clear(false);using(var saved=JsonDocument.Parse(new QqqGexResponseStore(path).ReadLifecycle(route)!.Body)){Assert.True(saved.RootElement.GetProperty("recorded").GetBoolean());Assert.Equal(3,saved.RootElement.GetProperty("points")[0].GetProperty("score").GetInt32());Assert.False(saved.RootElement.GetProperty("complete").GetBoolean());}
        point=point.Replace("2026-01-02","2026-01-03");command.CommandText="UPDATE qqq_gex_pcs_lifecycle SET body=$body,sha256=$hash";command.Parameters["$body"].Value=point;command.Parameters["$hash"].Value=Hash(point);command.ExecuteNonQuery();Assert.Throws<InvalidDataException>(()=>store.ReadLifecycle(route));Assert.Null(store.ReadLifecycle(route+"&unknown=1"));
    }

}
