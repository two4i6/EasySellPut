using Meili.Data.Cache;
using Microsoft.Data.Sqlite;
using System.Security.Cryptography;
using System.Text;
namespace Meili.Data.Tests;
public sealed class QqqGexMigrationTests
{
    static string Hash(byte[] b)=>Convert.ToHexString(SHA256.HashData(b));
    static string Seed(string root)
    {
        Directory.CreateDirectory(root);var source=Path.Combine(root,"source.db");using var c=new SqliteConnection("Data Source="+source+";Pooling=False");c.Open();using var q=c.CreateCommand();q.CommandText="PRAGMA journal_mode=WAL;CREATE TABLE qqq_gex_observed_inputs(identity TEXT PRIMARY KEY,received_at INTEGER,body_sha256 TEXT,body BLOB);CREATE TABLE qqq_gex_raw(sha256 TEXT PRIMARY KEY,source TEXT,received_at INTEGER,body BLOB);CREATE TABLE qqq_gex_provider_raw(sha256 TEXT PRIMARY KEY,source TEXT,as_of INTEGER,fetched_at INTEGER,body BLOB);CREATE TABLE qqq_gex_cache_meta(id INTEGER PRIMARY KEY,generation INTEGER);INSERT INTO qqq_gex_cache_meta VALUES(1,0)";q.ExecuteNonQuery();
        for(var i=0;i<70;i++){var body=Encoding.UTF8.GetBytes("{\"source\":\"synthetic-only\",\"i\":"+i+",\"data\":\""+new string('x',10000)+"\"}");q.CommandText="INSERT INTO qqq_gex_observed_inputs VALUES($id,123,$hash,$b)";q.Parameters.Clear();q.Parameters.AddWithValue("$id",i.ToString());q.Parameters.AddWithValue("$hash",Hash(body));q.Parameters.AddWithValue("$b",i%2==0?Encoding.UTF8.GetString(body):QqqGexArchiveBody.Encode(body,"gzip-v1"));q.ExecuteNonQuery();}
        q.Parameters.Clear();q.CommandText="UPDATE qqq_gex_observed_inputs SET rowid=-9223372036854775808 WHERE identity='0'";q.ExecuteNonQuery();q.CommandText="SELECT body_sha256 FROM qqq_gex_observed_inputs WHERE identity='0'";var h=(string)q.ExecuteScalar()!;q.CommandText="INSERT INTO qqq_gex_raw VALUES($h,'synthetic',123,'@observed-v1:0')";q.Parameters.AddWithValue("$h",h);q.ExecuteNonQuery();q.Parameters.Clear();var binary=Enumerable.Range(0,4096).Select(i=>(byte)i).ToArray();q.CommandText="INSERT INTO qqq_gex_provider_raw VALUES($h,'synthetic',123,456,$b)";q.Parameters.AddWithValue("$h",Hash(binary));q.Parameters.AddWithValue("$b",binary);q.ExecuteNonQuery();return source;
    }
    static string Root()=>Path.Combine(Path.GetTempPath(),"gex-migration-production-"+Guid.NewGuid());
    [Fact] public async Task Copy_migration_fences_old_writers_and_new_store_writes_v2_and_downgrades()
    {
        var root=Root();var source=Seed(root);var before=Hash(File.ReadAllBytes(source));var dest=Path.Combine(root,"v2.db");var migration=new QqqGexArchiveMigration();var result=await migration.RunAsync(source,dest);Assert.Equal("complete",result.Status);Assert.True(File.Exists(result.Backup));Assert.Equal(before,Hash(File.ReadAllBytes(source)));Assert.Equal(result,await migration.RunAsync(source,dest,resume:true));
        using(var old=new SqliteConnection("Data Source="+dest+";Pooling=False")){old.Open();using var q=old.CreateCommand();q.CommandText="UPDATE qqq_gex_cache_meta SET generation=1";Assert.Throws<SqliteException>(()=>q.ExecuteNonQuery());q.CommandText="DELETE FROM qqq_gex_observed_inputs";Assert.Throws<SqliteException>(()=>q.ExecuteNonQuery());}
        var store=new QqqGexResponseStore(dest);var body="{\"captures\":[],\"source\":\"new-guarded-write\"}";var identity=store.RecordObservedInput(body);Assert.Equal(body,store.ReadObservedInput(identity));Assert.True(store.Compact().Compacted);Assert.Equal(body,store.ReadObservedInput(identity));store.ReleaseIdleConnections();
        using(var c=new SqliteConnection("Data Source="+dest+";Pooling=False")){c.Open();using var q=c.CreateCommand();q.CommandText="SELECT body FROM qqq_gex_observed_inputs WHERE identity=$id";q.Parameters.AddWithValue("$id",identity);Assert.Equal("brotli-v2",QqqGexArchiveBody.EncodingOf((byte[])q.ExecuteScalar()!));}
        var legacy=Path.Combine(root,"downgraded.db");await migration.RunAsync(dest,legacy,"gzip-v1");using(var c=new SqliteConnection("Data Source="+legacy+";Pooling=False")){c.Open();using var q=c.CreateCommand();q.CommandText="UPDATE qqq_gex_cache_meta SET generation=2";Assert.Equal(1,q.ExecuteNonQuery());}
        var restored=await migration.RestoreAsync(dest,Path.Combine(root,"restored.db"));Assert.Equal(result.SnapshotDigest,restored.SnapshotDigest);Assert.Equal(before,Hash(File.ReadAllBytes(source)));
    }
    [Fact] public async Task Cancellation_partial_transactions_resume_and_backup_corruption_refuses_publish()
    {
        var root=Root();var source=Seed(root);var before=Hash(File.ReadAllBytes(source));var dest=Path.Combine(root,"cancel.db");using var stop=new CancellationTokenSource();var calls=0;
        var service=new QqqGexArchiveMigration(_=>long.MaxValue,(stage,_)=>{if(stage=="batch"&&++calls==2)stop.Cancel();});await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>service.RunAsync(source,dest,ct:stop.Token));Assert.False(File.Exists(dest));Assert.True(File.Exists(dest+".backup.db"));
        await new QqqGexArchiveMigration().RunAsync(source,dest,resume:true);Assert.Equal(before,Hash(File.ReadAllBytes(source)));
        var broken=Path.Combine(root,"broken.db");using var cancel=new CancellationTokenSource();var pause=new QqqGexArchiveMigration(_=>long.MaxValue,(stage,_)=>{if(stage=="batch")cancel.Cancel();});await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>pause.RunAsync(source,broken,ct:cancel.Token));File.AppendAllText(broken+".backup.db","corrupt");await Assert.ThrowsAsync<InvalidDataException>(()=>new QqqGexArchiveMigration().RunAsync(source,broken,resume:true));Assert.False(File.Exists(broken));Assert.Equal(before,Hash(File.ReadAllBytes(source)));
    }
    [Fact] public async Task Resume_uses_verified_backup_if_original_goes_offline_and_corrupt_original_is_never_published()
    {
        var root=Root();var source=Seed(root);var dest=Path.Combine(root,"offline.db");using var stop=new CancellationTokenSource();
        var pause=new QqqGexArchiveMigration(_=>long.MaxValue,(stage,_)=>{if(stage=="batch")stop.Cancel();});
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>pause.RunAsync(source,dest,ct:stop.Token));File.Move(source,source+".offline");
        Assert.Equal("complete",(await new QqqGexArchiveMigration().RunAsync(source,dest,resume:true)).Status);
        var corrupt=Seed(Path.Combine(root,"bad"));using(var c=new SqliteConnection("Data Source="+corrupt+";Pooling=False")){c.Open();using var q=c.CreateCommand();q.CommandText="UPDATE qqq_gex_observed_inputs SET body='corrupt' WHERE identity='0'";q.ExecuteNonQuery();}
        var hash=Hash(File.ReadAllBytes(corrupt));var target=Path.Combine(root,"corrupt-destination.db");await Assert.ThrowsAsync<InvalidDataException>(()=>new QqqGexArchiveMigration().RunAsync(corrupt,target));Assert.False(File.Exists(target));Assert.Equal(hash,Hash(File.ReadAllBytes(corrupt)));
    }
    [Fact] public async Task Very_old_fragment_cannot_create_unfenced_startup_or_future_history_tables()
    {
        var root=Root();Directory.CreateDirectory(root);var source=Path.Combine(root,"old-fragment.db");using(var c=new SqliteConnection("Data Source="+source+";Pooling=False")){c.Open();using var q=c.CreateCommand();q.CommandText="CREATE TABLE qqq_gex_provider_raw(sha256 TEXT PRIMARY KEY,source TEXT,as_of INTEGER,fetched_at INTEGER,body BLOB)";q.ExecuteNonQuery();}
        var provider=Encoding.UTF8.GetBytes("@observed-v1:original-provider-literal");using(var c=new SqliteConnection("Data Source="+source+";Pooling=False")){c.Open();using var q=c.CreateCommand();q.CommandText="INSERT INTO qqq_gex_provider_raw VALUES($h,'old',123,456,$b)";q.Parameters.AddWithValue("$h",Hash(provider));q.Parameters.AddWithValue("$b",Encoding.UTF8.GetString(provider));q.ExecuteNonQuery();}
        var dest=Path.Combine(root,"guarded.db");await new QqqGexArchiveMigration().RunAsync(source,dest);Assert.Equal(provider,QqqGexResponseStore.ReadProviderBodyReadOnly(dest,Hash(provider)));
        using var old=new SqliteConnection("Data Source="+dest+";Pooling=False");old.Open();using var command=old.CreateCommand();
        foreach(var sql in new[]{"INSERT OR IGNORE INTO qqq_gex_cache_meta VALUES(1,0)","INSERT INTO qqq_gex_observed_imports VALUES('old','partial',NULL,0)","INSERT INTO qqq_gex_raw VALUES('old','old',0,'{}')"}){command.CommandText=sql;Assert.Throws<SqliteException>(()=>command.ExecuteNonQuery());}
        command.CommandText="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'qqq_gex_%'";var tables=new List<string>();using(var rows=command.ExecuteReader())while(rows.Read())tables.Add(rows.GetString(0));foreach(var table in tables){command.CommandText="INSERT INTO \""+table+"\" DEFAULT VALUES";var error=Assert.Throws<SqliteException>(()=>command.ExecuteNonQuery());Assert.Contains("gex_v2_writer",error.Message);}command.CommandText="DROP TRIGGER gex_v2_qqq_gex_raw_INSERT";command.ExecuteNonQuery();Assert.Throws<InvalidDataException>(()=>new QqqGexResponseStore(dest));
    }
    [Fact] public async Task Interrupted_initial_work_copy_resumes_from_backup_without_publishing_partial_data()
    {
        var root=Root();var source=Seed(root);var dest=Path.Combine(root,"work-copy.db");using var stop=new CancellationTokenSource();var service=new QqqGexArchiveMigration(_=>long.MaxValue,(stage,_)=>{if(stage=="work-copy")stop.Cancel();});
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>service.RunAsync(source,dest,ct:stop.Token));Assert.False(File.Exists(dest));Assert.True(File.Exists(dest+".backup.db"));
        var completed=await new QqqGexArchiveMigration().RunAsync(source,dest,resume:true);Assert.Equal("complete",completed.Status);Assert.NotEmpty(Directory.GetFiles(root,"*.unverified-*"));
    }
    [Fact] public async Task Source_cannot_alias_reserved_migration_sidecars()
    {
        var root=Root();var seed=Seed(root);foreach(var suffix in new[]{".migration.db",".migration.lock",".backup.db"})
        {
            var dest=Path.Combine(root,Guid.NewGuid()+".db");var source=dest+suffix;File.Copy(seed,source);var before=Hash(File.ReadAllBytes(source));await Assert.ThrowsAsync<ArgumentException>(()=>new QqqGexArchiveMigration().RunAsync(source,dest));Assert.Equal(before,Hash(File.ReadAllBytes(source)));Assert.False(File.Exists(dest));
        }
    }
    [Fact] public async Task Cancellation_at_publication_keeps_ready_work_private_and_can_resume()
    {
        var root=Root();var source=Seed(root);var dest=Path.Combine(root,"publish-cancel.db");using var stop=new CancellationTokenSource();var service=new QqqGexArchiveMigration(_=>long.MaxValue,(stage,_)=>{if(stage=="publish")stop.Cancel();});
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>service.RunAsync(source,dest,ct:stop.Token));Assert.False(File.Exists(dest));Assert.True(File.Exists(dest+".backup.db"));Assert.Equal("complete",(await new QqqGexArchiveMigration().RunAsync(source,dest,resume:true)).Status);
    }
    [Fact] public async Task Disk_preflight_and_sqlite_full_keep_source_and_resume()
    {
        var root=Root();var source=Seed(root);var before=Hash(File.ReadAllBytes(source));var dest=Path.Combine(root,"space.db");await Assert.ThrowsAsync<IOException>(()=>new QqqGexArchiveMigration(_=>0,null).RunAsync(source,dest));Assert.False(File.Exists(dest+".migration.db"));
        var full=Path.Combine(root,"full.db");var injected=false;var service=new QqqGexArchiveMigration(_=>long.MaxValue,(stage,c)=>{if(stage!="working"||injected)return;injected=true;using var q=c.CreateCommand();q.CommandText="PRAGMA max_page_count";var pages=c.CreateCommand();pages.CommandText="PRAGMA page_count";var n=pages.ExecuteScalar();q.CommandText="PRAGMA max_page_count="+n;q.ExecuteScalar();using var tx=c.BeginTransaction();q.Transaction=tx;q.CommandText="CREATE TABLE test_full(b BLOB);INSERT INTO test_full VALUES(zeroblob(16777216))";q.ExecuteNonQuery();});
        await Assert.ThrowsAsync<SqliteException>(()=>service.RunAsync(source,full));Assert.False(File.Exists(full));Assert.True(File.Exists(full+".backup.db"));await new QqqGexArchiveMigration().RunAsync(source,full,resume:true);Assert.Equal(before,Hash(File.ReadAllBytes(source)));
    }
}
