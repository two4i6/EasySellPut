using Microsoft.Data.Sqlite;
namespace Meili.Data.Cache;
/// <summary>Fail-closed version gate. SQLite triggers block older clients without the writer function.</summary>
internal static class QqqGexArchiveGate
{
    internal static void Configure(SqliteConnection c)
    {
        c.CreateFunction("gex_v2_writer",()=>2,isDeterministic:true);
        using var cmd=c.CreateCommand();cmd.CommandText="SELECT 1 FROM sqlite_master WHERE name='qqq_gex_archive_format'";
        if(cmd.ExecuteScalar() is null){if(QqqGexArchiveBody.WriteCodec()=="brotli-v2")throw new InvalidDataException("Migrate to a separate guarded archive before enabling v2");return;}
        cmd.CommandText="SELECT version,status FROM qqq_gex_archive_format WHERE id=1";using var r=cmd.ExecuteReader();
        if(!r.Read()||r.GetInt64(0)!=2||r.GetString(1)!="ready")throw new InvalidDataException("GEX archive version is unsupported or migration is incomplete");
        VerifyFence(c);QqqGexArchiveBody.WriteCodec();
    }
    internal static void VerifyFence(SqliteConnection c)
    {
        var names=new[]{"qqq_gex_cache_meta","qqq_gex_wire","qqq_gex_local_days","qqq_gex_local_day_hashes","qqq_gex_raw","qqq_gex_observed_inputs","qqq_gex_provider_raw","qqq_gex_local_rows","qqq_gex_partial_days","qqq_gex_context_days","qqq_gex_local_summaries","qqq_gex_import_receipts","qqq_gex_pcs_lifecycle","qqq_gex_live_signals","qqq_gex_observed_imports","qqq_gex_archive_format","qqq_gex_archive_receipt"};
        using var q=c.CreateCommand();q.CommandText="SELECT name,sql FROM sqlite_master WHERE type='trigger'";var guards=new Dictionary<string,string>(StringComparer.Ordinal);using(var r=q.ExecuteReader())while(r.Read())guards[r.GetString(0)]=r.GetString(1);
        foreach(var table in names)foreach(var op in new[]{"INSERT","UPDATE","DELETE"})if(!guards.TryGetValue("gex_v2_"+table+"_"+op,out var sql)||(!sql.Contains("gex_v2_writer()!=2",StringComparison.Ordinal)||!sql.Contains(" BEFORE "+op+" ON \""+table+"\" ",StringComparison.Ordinal)))throw new InvalidDataException("GEX archive compatibility fence missing or invalid; create a new verified migration copy");
    }
    internal static string Codec(SqliteConnection c)
    {
        using var cmd=c.CreateCommand();cmd.CommandText="SELECT 1 FROM sqlite_master WHERE name='qqq_gex_archive_format'";
        return cmd.ExecuteScalar() is null?"gzip-v1":"brotli-v2";
    }
    internal static void EnsureKnownWriterTables(SqliteConnection c,SqliteTransaction tx)
    {
        // Precreate the full known old-writer surface, including empty legacy
        // archives. Otherwise an old client could create an unfenced missing table.
        using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="""
CREATE TABLE IF NOT EXISTS qqq_gex_cache_meta(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS qqq_gex_wire(snapshot TEXT NOT NULL,request_key TEXT NOT NULL,content_type TEXT NOT NULL,body TEXT NOT NULL,revision TEXT NOT NULL,as_of INTEGER NOT NULL,expires_at INTEGER NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(snapshot,request_key));
CREATE TABLE IF NOT EXISTS qqq_gex_local_days(day TEXT PRIMARY KEY,revision TEXT NOT NULL,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS qqq_gex_local_day_hashes(day TEXT PRIMARY KEY,sha256 TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS qqq_gex_raw(sha256 TEXT PRIMARY KEY,source TEXT NOT NULL,received_at INTEGER NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS qqq_gex_observed_inputs(identity TEXT PRIMARY KEY,received_at INTEGER NOT NULL,body_sha256 TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS qqq_gex_provider_raw(sha256 TEXT PRIMARY KEY,source TEXT NOT NULL,as_of INTEGER NOT NULL,fetched_at INTEGER NOT NULL,body BLOB NOT NULL,encoding TEXT NOT NULL DEFAULT 'identity');
CREATE TABLE IF NOT EXISTS qqq_gex_local_rows(row_key TEXT PRIMARY KEY,day TEXT NOT NULL,expiry TEXT NOT NULL,captured_at TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS qqq_gex_partial_days(day TEXT PRIMARY KEY,revision TEXT NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS qqq_gex_context_days(day TEXT PRIMARY KEY,revision TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS qqq_gex_local_summaries(day TEXT PRIMARY KEY,revision TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS qqq_gex_import_receipts(revision TEXT PRIMARY KEY,result TEXT NOT NULL,sha256 TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS qqq_gex_pcs_lifecycle(day TEXT NOT NULL,time TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(day,time));
CREATE TABLE IF NOT EXISTS qqq_gex_live_signals(signal_id TEXT PRIMARY KEY,day TEXT NOT NULL,anchor_at TEXT NOT NULL,body TEXT NOT NULL,factors TEXT NOT NULL,sha256 TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS qqq_gex_observed_imports(identity TEXT PRIMARY KEY,status TEXT NOT NULL,error TEXT,updated_at INTEGER NOT NULL);
""";q.ExecuteNonQuery();
    }
    internal static void Fence(SqliteConnection c,SqliteTransaction? tx=null)
    {
        using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'qqq_gex_%'";var names=new List<string>();using(var r=q.ExecuteReader())while(r.Read())names.Add(r.GetString(0));
        foreach(var name in names)foreach(var op in new[]{"INSERT","UPDATE","DELETE"})
        {
            using var cmd=c.CreateCommand();cmd.Transaction=tx;var table='"'+name.Replace("\"","\"\"")+'"';var trigger='"'+("gex_v2_"+name+"_"+op).Replace("\"","\"\"")+'"';
            cmd.CommandText=$"CREATE TRIGGER IF NOT EXISTS {trigger} BEFORE {op} ON {table} BEGIN SELECT CASE WHEN gex_v2_writer()!=2 THEN RAISE(ABORT,'Updated GEX archive client required') END; END";cmd.ExecuteNonQuery();
        }
    }
}
