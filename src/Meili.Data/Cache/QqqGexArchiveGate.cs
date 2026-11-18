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
        QqqGexArchiveBody.WriteCodec();
    }
    internal static string Codec(SqliteConnection c)
    {
        using var cmd=c.CreateCommand();cmd.CommandText="SELECT 1 FROM sqlite_master WHERE name='qqq_gex_archive_format'";
        return cmd.ExecuteScalar() is null?"gzip-v1":"brotli-v2";
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
