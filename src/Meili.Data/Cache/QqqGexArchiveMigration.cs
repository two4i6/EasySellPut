using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
namespace Meili.Data.Cache;

public sealed record GexArchiveMigrationResult(string Status,string Destination,string Backup,string BackupSha256,string Codec,long ProcessedRows,string? SnapshotDigest);
/// <summary>Explicit copy-only maintenance. Never replaces a source or activates a data directory.</summary>
public sealed class QqqGexArchiveMigration
{
    const long Reserve=256L*1024*1024,BodyBudget=256L*1024*1024;
    static readonly (string Table,string Hash)[] Scopes=[("qqq_gex_local_rows","sha256"),("qqq_gex_observed_inputs","body_sha256"),("qqq_gex_raw","sha256"),("qqq_gex_provider_raw","sha256")];
    readonly Func<string,long> available;readonly Action<string,SqliteConnection>? checkpoint;
    public QqqGexArchiveMigration():this(AvailableSpace,null){}
    static long AvailableSpace(string path)
    {
        var full=Path.GetFullPath(path);var comparison=OperatingSystem.IsWindows()?StringComparison.OrdinalIgnoreCase:StringComparison.Ordinal;
        var drive=DriveInfo.GetDrives().Where(d=>full.StartsWith((Path.EndsInDirectorySeparator(d.Name)?d.Name:d.Name+Path.DirectorySeparatorChar),comparison)||full==d.Name).OrderByDescending(d=>d.Name.Length).FirstOrDefault()??throw new IOException("Destination volume unavailable");
        return drive.AvailableFreeSpace;
    }
    internal QqqGexArchiveMigration(Func<string,long> available,Action<string,SqliteConnection>? checkpoint){this.available=available;this.checkpoint=checkpoint;}
    static string Hash(byte[] b)=>Convert.ToHexString(SHA256.HashData(b));
    static string FileHash(string p){using var f=new FileStream(p,FileMode.Open,FileAccess.Read,FileShare.Read);return Convert.ToHexString(SHA256.HashData(f));}
    static SqliteConnection Open(string path,bool readOnly=false){var c=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=path,Mode=readOnly?SqliteOpenMode.ReadOnly:SqliteOpenMode.ReadWrite,Pooling=false,DefaultTimeout=5}.ToString());c.Open();c.CreateFunction("gex_v2_writer",()=>2,isDeterministic:true);return c;}
    static object? Scalar(SqliteConnection c,string sql,SqliteTransaction? tx=null){using var q=c.CreateCommand();q.Transaction=tx;q.CommandText=sql;return q.ExecuteScalar();}
    static bool Exists(SqliteConnection c,string table)=>Scalar(c,"SELECT 1 FROM sqlite_master WHERE type='table' AND name='"+table+"'") is not null;
    static void Exec(SqliteConnection c,string sql,SqliteTransaction? tx=null){using var q=c.CreateCommand();q.Transaction=tx;q.CommandText=sql;q.ExecuteNonQuery();}
    static void PathCheck(string p){for(var d=new FileInfo(p).Directory;d is not null;d=d.Parent)if(d.LinkTarget is not null)throw new IOException("Migration paths must not traverse symbolic links");if(File.Exists(p)&&new FileInfo(p).LinkTarget is not null)throw new IOException("Migration source must not be a symbolic link");}
    void Space(string destination,long incoming){if(available(destination)<checked(Reserve+BodyBudget+incoming))throw new IOException("GEX migration space reserve reached; source and verified backup retained");}
    public Task<GexArchiveMigrationResult> RunAsync(string source,string destination,string codec="brotli-v2",bool resume=false,CancellationToken ct=default)=>Task.Run(()=>Run(source,destination,codec,resume,ct),ct);
    public GexArchiveMigrationResult Status(string destination)
    {
        destination=Path.GetFullPath(destination);using var c=Open(destination+".migration.db",true);return Report(c,destination);
    }
    public Task<GexArchiveMigrationResult> RestoreAsync(string migrationDestination,string destination,CancellationToken ct=default)
    {
        var state=Status(migrationDestination);if(!File.Exists(state.Backup)||FileHash(state.Backup)!=state.BackupSha256)throw new InvalidDataException("Verified migration backup missing or corrupt");
        return RunAsync(state.Backup,destination,"gzip-v1",false,ct);
    }
    static GexArchiveMigrationResult Report(SqliteConnection c,string destination)
    {
        using var q=c.CreateCommand();q.CommandText="SELECT phase,backup,backup_sha,codec,converted,digest FROM migration WHERE id=1";using var r=q.ExecuteReader();if(!r.Read())throw new InvalidDataException("Migration state missing");return new(r.GetString(0),destination,r.GetString(1),r.GetString(2),r.GetString(3),r.GetInt64(4),r.IsDBNull(5)?null:r.GetString(5));
    }
    static void Set(SqliteConnection c,string field,object value){using var q=c.CreateCommand();q.CommandText=$"UPDATE migration SET {field}=$v WHERE id=1";q.Parameters.AddWithValue("$v",value);q.ExecuteNonQuery();}
    GexArchiveMigrationResult Run(string source,string destination,string codec,bool resume,CancellationToken ct)
    {
        QqqGexArchiveBody.WriteCodec(codec);source=Path.GetFullPath(source);destination=Path.GetFullPath(destination);PathCheck(source);PathCheck(destination);
        if(source==destination||(!resume&&!File.Exists(source)))throw new ArgumentException("An existing source and a separate NEW destination are required");
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);ct.ThrowIfCancellationRequested();
        using var lease=new FileStream(destination+".migration.lock",FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
        var statePath=destination+".migration.db";
        if(!File.Exists(statePath))
        {
            if(resume||File.Exists(destination)||File.Exists(destination+".backup.db"))throw new IOException("Destination/backup already exists or no resumable state exists");
            var bytes=checked(new FileInfo(source).Length+(File.Exists(source+"-wal")?new FileInfo(source+"-wal").Length:0));Space(destination,checked(bytes*3));
            using(new FileStream(statePath,FileMode.CreateNew,FileAccess.Write,FileShare.None)){}
            using var init=Open(statePath);Exec(init,"CREATE TABLE migration(id INTEGER PRIMARY KEY CHECK(id=1),source TEXT,backup TEXT,backup_sha TEXT,work TEXT,codec TEXT,phase TEXT,converted INTEGER,digest TEXT)");
            using var q=init.CreateCommand();q.CommandText="INSERT INTO migration VALUES(1,$s,$b,'',$w,$c,'snapshot',0,NULL)";q.Parameters.AddWithValue("$s",source);q.Parameters.AddWithValue("$b",destination+".backup.db");q.Parameters.AddWithValue("$w",destination+".working-"+Guid.NewGuid().ToString("N")+".db");q.Parameters.AddWithValue("$c",codec);q.ExecuteNonQuery();
        }
        else if(!resume)throw new IOException("Migration state exists; use explicit resume");
        using var state=Open(statePath);string backup,work,phase,backupSha;
        using(var q=state.CreateCommand()){q.CommandText="SELECT source,backup,work,codec,phase,backup_sha FROM migration WHERE id=1";using var r=q.ExecuteReader();if(!r.Read()||r.GetString(0)!=source||r.GetString(3)!=codec)throw new InvalidDataException("Resume source or codec mismatch");backup=r.GetString(1);work=r.GetString(2);phase=r.GetString(4);backupSha=r.GetString(5);}
        if(Path.GetDirectoryName(backup)!=Path.GetDirectoryName(destination)||backup!=destination+".backup.db"||Path.GetDirectoryName(work)!=Path.GetDirectoryName(destination)||!Path.GetFileName(work).StartsWith(Path.GetFileName(destination)+".working-",StringComparison.Ordinal))throw new InvalidDataException("Migration state paths are invalid");
        ct.ThrowIfCancellationRequested();
        if(backupSha.Length==0)
        {
            if(File.Exists(backup))File.Move(backup,backup+".unverified-"+Guid.NewGuid().ToString("N"));
            using(new FileStream(backup,FileMode.CreateNew,FileAccess.Write,FileShare.None)){}
            using(var input=Open(source,true))using(var output=Open(backup)){if(Exists(input,"qqq_gex_archive_format")&&(Scalar(input,"SELECT status FROM qqq_gex_archive_format WHERE id=1")?.ToString()!="ready"||Convert.ToInt64(Scalar(input,"SELECT version FROM qqq_gex_archive_format WHERE id=1"))!=2))throw new InvalidDataException("Source migration is incomplete or unsupported");input.BackupDatabase(output);}
            // BackupDatabase is one synchronous online snapshot; cancellation is checked
            // immediately after it. An unaccepted partial backup is never published.
            checkpoint?.Invoke("snapshot",state);ct.ThrowIfCancellationRequested();
            using(var original=Open(backup,true)){var digest=Digest(original,ct);Set(state,"digest",digest);}
            backupSha=FileHash(backup);Set(state,"backup_sha",backupSha);Set(state,"phase","copied");
        }
        if(!File.Exists(backup)||FileHash(backup)!=backupSha)throw new InvalidDataException("Verified backup missing or corrupt; no migration or restore performed");
        var report=Report(state,destination);if(report.Status=="complete"){VerifyPublication(destination,work,codec,backupSha,ct);return report;}
        if(File.Exists(destination))
        {
            // Recovery for a crash after atomic rename but before state acknowledgement.
            VerifyPublication(destination,work,codec,backupSha,ct);
            Set(state,"phase","complete");return Report(state,destination);
        }
        Space(destination,checked(new FileInfo(backup).Length*2));
        if(!File.Exists(work))
        {
            using(new FileStream(work,FileMode.CreateNew,FileAccess.Write,FileShare.None)){}
            using(var input=Open(backup,true))using(var output=Open(work)){input.BackupDatabase(output);}
        }
        using(var c=Open(work))
        {
            if(!Exists(c,"qqq_gex_migration_progress"))
            {
                using var tx=c.BeginTransaction();RemoveGate(c,tx);Exec(c,"CREATE TABLE qqq_gex_archive_format(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,status TEXT NOT NULL);INSERT INTO qqq_gex_archive_format VALUES(1,2,'pending');CREATE TABLE qqq_gex_migration_progress(scope INTEGER PRIMARY KEY,cursor INTEGER NOT NULL,converted INTEGER NOT NULL)",tx);QqqGexArchiveGate.Fence(c,tx);tx.Commit();
            }
            Set(state,"phase","converting");checkpoint?.Invoke("working",c);
            for(var scope=0;scope<Scopes.Length;scope++)
            {
                var (table,hashColumn)=Scopes[scope];if(!Exists(c,table))continue;
                // Old provider schemas had no encoding column and stored identity bytes.
                if(table=="qqq_gex_provider_raw"&&!HasColumn(c,table,"encoding"))Exec(c,"ALTER TABLE qqq_gex_provider_raw ADD COLUMN encoding TEXT NOT NULL DEFAULT 'identity'");
                while(true)
                {
                    ct.ThrowIfCancellationRequested();Space(destination,BodyBudget);using var tx=c.BeginTransaction();
                    var savedCursor=Scalar(c,$"SELECT cursor FROM qqq_gex_migration_progress WHERE scope={scope}",tx);var cursor=savedCursor is null?0:Convert.ToInt64(savedCursor);var rows=new List<(long Id,object Body,string Hash,string? Encoding)>();
                    using(var q=c.CreateCommand()){q.Transaction=tx;q.CommandText=$"SELECT rowid,body,{hashColumn}"+(table=="qqq_gex_provider_raw"?",encoding":"")+$" FROM {table} WHERE ($first=1 OR rowid>$cursor) ORDER BY rowid LIMIT 32";q.Parameters.AddWithValue("$cursor",cursor);q.Parameters.AddWithValue("$first",savedCursor is null?1:0);using var r=q.ExecuteReader();while(r.Read())rows.Add((r.GetInt64(0),r.GetValue(1),r.GetString(2),table=="qqq_gex_provider_raw"?r.GetString(3):null));}
                    if(rows.Count==0){tx.Commit();break;}
                    foreach(var row in rows)
                    {
                        ct.ThrowIfCancellationRequested();var raw=Original(c,table,row.Body,row.Hash,row.Encoding,tx);
                        if(row.Body is string text&&text.StartsWith("@observed-v1:",StringComparison.Ordinal))continue;
                        var encoded=QqqGexArchiveBody.Encode(raw,codec);if(!raw.AsSpan().SequenceEqual(QqqGexArchiveBody.DecodeBytes(encoded,128*1024*1024)))throw new InvalidDataException("Migration roundtrip failed");
                        using var q=c.CreateCommand();q.Transaction=tx;q.CommandText=$"UPDATE {table} SET body=$b"+(table=="qqq_gex_provider_raw"?",encoding=$e":"")+" WHERE rowid=$id";q.Parameters.AddWithValue("$b",encoded);q.Parameters.AddWithValue("$id",row.Id);if(row.Encoding is not null)q.Parameters.AddWithValue("$e",codec);q.ExecuteNonQuery();
                    }
                    using(var q=c.CreateCommand()){q.Transaction=tx;q.CommandText="INSERT INTO qqq_gex_migration_progress VALUES($s,$c,$n) ON CONFLICT(scope) DO UPDATE SET cursor=excluded.cursor,converted=converted+excluded.converted";q.Parameters.AddWithValue("$s",scope);q.Parameters.AddWithValue("$c",rows[^1].Id);q.Parameters.AddWithValue("$n",rows.Count);q.ExecuteNonQuery();}
                    checkpoint?.Invoke("batch",c);ct.ThrowIfCancellationRequested();tx.Commit();
                }
            }
            ct.ThrowIfCancellationRequested();checkpoint?.Invoke("validate",c);
            if(Digest(c,ct)!=Report(state,destination).SnapshotDigest)throw new InvalidDataException("Migration full snapshot verification failed");
            var count=Convert.ToInt64(Scalar(c,"SELECT COALESCE(SUM(converted),0) FROM qqq_gex_migration_progress"));Set(state,"converted",count);
            using(var tx=c.BeginTransaction()){Exec(c,"DROP TABLE qqq_gex_migration_progress;DROP TABLE IF EXISTS qqq_gex_archive_receipt;CREATE TABLE qqq_gex_archive_receipt(id INTEGER PRIMARY KEY CHECK(id=1),migration_id TEXT NOT NULL,codec TEXT NOT NULL,backup_sha TEXT NOT NULL)",tx);
            using(var receipt=c.CreateCommand()){receipt.Transaction=tx;receipt.CommandText="INSERT INTO qqq_gex_archive_receipt VALUES(1,$id,$codec,$hash)";receipt.Parameters.AddWithValue("$id",Path.GetFileName(work));receipt.Parameters.AddWithValue("$codec",codec);receipt.Parameters.AddWithValue("$hash",backupSha);receipt.ExecuteNonQuery();}if(codec=="brotli-v2"){Exec(c,"UPDATE qqq_gex_archive_format SET status='ready' WHERE id=1",tx);QqqGexArchiveGate.Fence(c,tx);}else RemoveGate(c,tx);tx.Commit();}
            Exec(c,"PRAGMA wal_checkpoint(TRUNCATE)");
        }
        ct.ThrowIfCancellationRequested();Set(state,"phase","validated");
        if(FileHash(backup)!=backupSha)throw new InvalidDataException("Backup changed during migration");
        File.Move(work,destination);Set(state,"phase","complete");return Report(state,destination);
    }
    static void VerifyPublication(string destination,string work,string codec,string backupSha,CancellationToken ct)
    {
        if(!File.Exists(destination))throw new InvalidDataException("Published destination missing");using var c=Open(destination,true);
        if(!Exists(c,"qqq_gex_archive_receipt")||Scalar(c,"SELECT migration_id FROM qqq_gex_archive_receipt WHERE id=1")?.ToString()!=Path.GetFileName(work)||Scalar(c,"SELECT codec FROM qqq_gex_archive_receipt WHERE id=1")?.ToString()!=codec||Scalar(c,"SELECT backup_sha FROM qqq_gex_archive_receipt WHERE id=1")?.ToString()!=backupSha)throw new InvalidDataException("Existing destination is not this verified migration publication; never overwritten");
        if(codec=="brotli-v2"&&(!Exists(c,"qqq_gex_archive_format")||Scalar(c,"SELECT status FROM qqq_gex_archive_format WHERE id=1")?.ToString()!="ready"||Convert.ToInt64(Scalar(c,"SELECT version FROM qqq_gex_archive_format WHERE id=1"))!=2))throw new InvalidDataException("Published archive gate invalid");
        _=Digest(c,ct); // verify current records, allowing legitimate post-publication writes
    }
    static bool HasColumn(SqliteConnection c,string table,string column){using var q=c.CreateCommand();q.CommandText=$"PRAGMA table_info({table})";using var r=q.ExecuteReader();while(r.Read())if(r.GetString(1)==column)return true;return false;}
    static void RemoveGate(SqliteConnection c,SqliteTransaction tx)
    {
        using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'gex_v2_%'";var names=new List<string>();using(var r=q.ExecuteReader())while(r.Read())names.Add(r.GetString(0));foreach(var name in names)Exec(c,"DROP TRIGGER \""+name.Replace("\"","\"\"")+"\"",tx);Exec(c,"DROP TABLE IF EXISTS qqq_gex_archive_format",tx);
    }
    static byte[] Original(SqliteConnection c,string table,object body,string expected,string? encoding,SqliteTransaction? tx=null)
    {
        byte[] raw;if(body is string reference&&reference.StartsWith("@observed-v1:",StringComparison.Ordinal))
        {
            using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="SELECT body FROM qqq_gex_observed_inputs WHERE identity=$id";q.Parameters.AddWithValue("$id",reference[13..]);var input=q.ExecuteScalar()??throw new InvalidDataException("Observed reference missing");raw=QqqGexArchiveBody.DecodeBytes(input,128*1024*1024);
        }
        else if(table=="qqq_gex_provider_raw"&&encoding is null or "identity")raw=(byte[])body;
        else {if(table=="qqq_gex_provider_raw"&&(encoding is not ("gzip-v1" or "brotli-v2")||body is not byte[] encoded||QqqGexArchiveBody.EncodingOf(encoded)!=encoding))throw new InvalidDataException("Unsupported provider encoding");raw=QqqGexArchiveBody.DecodeBytes(body,table=="qqq_gex_local_rows"?16*1024*1024:128*1024*1024);}
        if(raw.Length>128*1024*1024||!Hash(raw).Equals(expected,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Original archive hash mismatch");return raw;
    }
    static void ValidateDay(SqliteConnection c,string table,string[] fields,SqliteDataReader r)
    {
        var payload=r.GetString(Array.IndexOf(fields,"payload"));string expected;
        if(table=="qqq_gex_partial_days")expected=r.GetString(Array.IndexOf(fields,"sha256"));
        else{using var q=c.CreateCommand();q.CommandText="SELECT sha256 FROM qqq_gex_local_day_hashes WHERE day=$d";q.Parameters.AddWithValue("$d",r.GetValue(Array.IndexOf(fields,"day")));expected=q.ExecuteScalar()?.ToString()??throw new InvalidDataException("Day hash missing");}
        if(!Hash(Encoding.UTF8.GetBytes(payload)).Equals(expected,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Day metadata hash mismatch");
        using var day=JsonDocument.Parse(payload);foreach(var pointer in day.RootElement.GetProperty("rows").EnumerateArray())
        {
            if(!pointer.TryGetProperty("profileRef",out var reference))continue;using var q=c.CreateCommand();q.CommandText="SELECT body,sha256 FROM qqq_gex_local_rows WHERE row_key=$id";q.Parameters.AddWithValue("$id",reference.GetString());using var row=q.ExecuteReader();
            if(!row.Read()||!row.GetString(1).Equals(pointer.GetProperty("rowSha256").GetString(),StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Profile pointer missing or corrupt");var bytes=QqqGexArchiveBody.DecodeBytes(row.GetValue(0),16*1024*1024);if(!Hash(bytes).Equals(row.GetString(1),StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Profile pointer hash mismatch");
            using var profile=JsonDocument.Parse(bytes);foreach(var key in new[]{"capturedAt","expiryDate"})if(profile.RootElement.GetProperty(key).GetString()!=pointer.GetProperty(key).GetString())throw new InvalidDataException("Profile pointer identity mismatch");
        }
    }
    static string Digest(SqliteConnection c,CancellationToken ct)
    {
        Exec(c,"BEGIN");try{return DigestCore(c,ct);}finally{Exec(c,"ROLLBACK");}
    }
    static string DigestCore(SqliteConnection c,CancellationToken ct)
    {
        if(Scalar(c,"PRAGMA integrity_check")?.ToString()!="ok")throw new InvalidDataException("SQLite backup integrity failed");
        var names=new List<string>();using(var q=c.CreateCommand()){q.CommandText="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('qqq_gex_archive_format','qqq_gex_migration_progress','qqq_gex_archive_receipt') ORDER BY name";using var r=q.ExecuteReader();while(r.Read())names.Add(r.GetString(0));}
        if(!names.Any(n=>n is "qqq_gex_local_rows" or "qqq_gex_observed_inputs" or "qqq_gex_raw" or "qqq_gex_provider_raw"))throw new InvalidDataException("Source is not a retained GEX archive");
        using var digest=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        void Add(byte[] b){digest.AppendData(BitConverter.GetBytes(b.Length));digest.AppendData(b);}
        foreach(var table in names)
        {
            ct.ThrowIfCancellationRequested();Add(Encoding.UTF8.GetBytes(table));using var q=c.CreateCommand();q.CommandText="SELECT * FROM \""+table.Replace("\"","\"\"")+"\" ORDER BY rowid";using var r=q.ExecuteReader();var fields=Enumerable.Range(0,r.FieldCount).Select(r.GetName).ToArray();
            var scope=Array.FindIndex(Scopes,s=>s.Table==table);var body=Array.IndexOf(fields,"body");var enc=Array.IndexOf(fields,"encoding");
            while(r.Read())
            {
                ct.ThrowIfCancellationRequested();Add([0x7f]);byte[]? raw=null;
                if(scope>=0){raw=Original(c,table,r.GetValue(body),r.GetString(Array.IndexOf(fields,Scopes[scope].Hash)),enc<0?null:r.GetString(enc));}
                if(scope<0&&body>=0&&Array.IndexOf(fields,"sha256") is var hashIndex&&hashIndex>=0&&r.GetValue(body) is string bodyText&&!Hash(Encoding.UTF8.GetBytes(bodyText)).Equals(r.GetString(hashIndex),StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Stored projection hash mismatch");
                if(table is "qqq_gex_local_days" or "qqq_gex_partial_days")ValidateDay(c,table,fields,r);
                for(var i=0;i<r.FieldCount;i++)
                {
                    // Provider encoding is representation metadata; absent legacy column
                    // and new encodings have the same logical manifest.
                    if(table=="qqq_gex_provider_raw"&&i==enc)continue;
                    Add(Encoding.UTF8.GetBytes(fields[i]));var value=r.GetValue(i);
                    if(i==body&&raw is not null){if(value is string s&&s.StartsWith("@observed-v1:",StringComparison.Ordinal))Add(Encoding.UTF8.GetBytes(s));else Add(raw);}
                    else if(value is byte[] bytes)Add(bytes);
                    else if(value is DBNull)Add([0]);
                    else if(value is string text)Add([1,..Encoding.UTF8.GetBytes(text)]);
                    else if(value is double number)Add([2,..Encoding.UTF8.GetBytes(number.ToString("R",CultureInfo.InvariantCulture))]);
                    else Add([3,..Encoding.UTF8.GetBytes(Convert.ToString(value,CultureInfo.InvariantCulture)??"")]);
                }
            }
        }
        return Convert.ToHexString(digest.GetHashAndReset());
    }
}
