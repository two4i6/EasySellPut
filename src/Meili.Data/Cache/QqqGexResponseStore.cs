using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
namespace Meili.Data.Cache;

/// <summary>Local wire responses keyed by exact canonical query and explicit snapshot identity.</summary>
public sealed partial class QqqGexResponseStore
{
    private readonly string connectionString;
    private readonly long capacityBytes;
    private volatile string? storageFailure;
    public bool IsUnavailable => storageFailure is not null;
    public sealed record Response(string ContentType,string Body,string Revision,DateTimeOffset AsOf,DateTimeOffset ExpiresAt);
    public QqqGexResponseStore(string path,long capacityBytes=QqqGexStoragePolicy.WireLimitBytes)
    {
        if(capacityBytes<1||capacityBytes>256L*1024*1024)throw new ArgumentOutOfRangeException(nameof(capacityBytes));this.capacityBytes=capacityBytes;
        var freshDatabase=!File.Exists(path);Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        connectionString=new SqliteConnectionStringBuilder{DataSource=path,Pooling=true}.ToString();
        try { using var c=Open();using var cmd=c.CreateCommand();if(freshDatabase){cmd.CommandText="PRAGMA auto_vacuum=INCREMENTAL";cmd.ExecuteNonQuery();}
        cmd.CommandText="CREATE TABLE IF NOT EXISTS qqq_gex_cache_meta(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL);INSERT OR IGNORE INTO qqq_gex_cache_meta VALUES(1,0)";cmd.ExecuteNonQuery();
        cmd.CommandText="CREATE TABLE IF NOT EXISTS qqq_gex_wire(snapshot TEXT NOT NULL,request_key TEXT NOT NULL,content_type TEXT NOT NULL,body TEXT NOT NULL,revision TEXT NOT NULL,as_of INTEGER NOT NULL,expires_at INTEGER NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(snapshot,request_key))";cmd.ExecuteNonQuery();
        cmd.CommandText="CREATE TABLE IF NOT EXISTS qqq_gex_local_days(day TEXT PRIMARY KEY,revision TEXT NOT NULL,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)";cmd.ExecuteNonQuery();
        cmd.CommandText="CREATE TABLE IF NOT EXISTS qqq_gex_local_day_hashes(day TEXT PRIMARY KEY,sha256 TEXT NOT NULL)";cmd.ExecuteNonQuery();
        } catch(SqliteException error) when(error.SqliteErrorCode is 11 or 26) { storageFailure="sqlite_corrupt";Meili.Core.Diagnostics.AppLog.Warn("qqq-gex","Corrupt storage retained; GEX unavailable, SQLite code "+error.SqliteErrorCode); }
    }
    /// <summary>Release this store's idle SQLite handles after a document host drains; active consumers are not interrupted.</summary>
    public void ReleaseIdleConnections(){using var connection=new SqliteConnection(connectionString);SqliteConnection.ClearPool(connection);}
    private SqliteConnection Open(){if(IsUnavailable)throw new InvalidDataException("GEX storage is unavailable; original file retained");var c=new SqliteConnection(connectionString);try{c.Open();QqqGexArchiveGate.Configure(c);return c;}catch{c.Dispose();throw;}}
    public object? LatestPartial()
    {
        using var c=Open();return ReadLatestPartialCore(c);
    }
    public static object? ReadLatestPartialReadOnly(string path)
    {
        using var c=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=path,Mode=SqliteOpenMode.ReadOnly}.ToString());c.Open();QqqGexArchiveGate.Configure(c);return ReadLatestPartialCore(c);
    }
    private static object? ReadLatestPartialCore(SqliteConnection c)
    {
        using var cmd=c.CreateCommand();cmd.CommandText="SELECT name FROM sqlite_master WHERE name='qqq_gex_partial_days'";if(cmd.ExecuteScalar() is null)return null;cmd.CommandText="SELECT payload,sha256 FROM qqq_gex_partial_days ORDER BY day DESC LIMIT 1";using var row=cmd.ExecuteReader();if(!row.Read())return null;var body=row.GetString(0);if(!Hash(body).Equals(row.GetString(1),StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Partial GEX integrity failed");using var doc=JsonDocument.Parse(body);var root=doc.RootElement;return new {date=root.GetProperty("date").GetString(),source=root.GetProperty("source").GetString(),complete=false,extendedHoursBars=root.TryGetProperty("extendedHoursBars",out var extended)?extended.GetArrayLength():0,regularBars=root.GetProperty("bars").GetArrayLength(),underlyingLastTradeAt=root.TryGetProperty("underlyingLastTradeAt",out var trade)?trade.Clone():(System.Text.Json.JsonElement?)null,issues=root.GetProperty("issues").Clone(),expiries=root.GetProperty("rows").EnumerateArray().GroupBy(r=>r.GetProperty("expiryDate").GetString()).Select(g=>g.Last()).Select(r=>new {expiry=r.GetProperty("expiryDate").GetString(),asOf=r.GetProperty("capturedAt").GetString(),calculationVersion=r.GetProperty("calculationVersion").GetString(),inputComplete=r.GetProperty("inputComplete").GetBoolean(),modelInputComplete=r.TryGetProperty("modelInputComplete",out var modelQuality)?modelQuality.GetBoolean():r.GetProperty("inputComplete").GetBoolean(),sourceTimeAligned=r.TryGetProperty("sourceTimeAligned",out var alignment)?(bool?)alignment.GetBoolean():null,netGex=r.GetProperty("netGex").Clone(),strikes=r.TryGetProperty("profileCount",out var profileCount)?profileCount.GetInt32():r.GetProperty("profile").GetArrayLength()}).ToArray()};
    }
    public bool HasLocalHistory(){using var c=Open();using var cmd=c.CreateCommand();cmd.CommandText="SELECT 1 FROM qqq_gex_local_days LIMIT 1";return cmd.ExecuteScalar() is not null;}
    public string RevisionToken()
    {
        using var c=Open();using var cmd=c.CreateCommand();cmd.CommandText="SELECT day,revision,updated_at FROM qqq_gex_local_days ORDER BY day";using var rows=cmd.ExecuteReader();var value=new StringBuilder();while(rows.Read())value.Append(rows.GetString(0)).Append('|').Append(rows.GetString(1)).Append('|').Append(rows.GetInt64(2)).Append('\n');using var partial=c.CreateCommand();partial.CommandText="SELECT name FROM sqlite_master WHERE type='table' AND name='qqq_gex_partial_days'";if(partial.ExecuteScalar() is not null){partial.CommandText="SELECT day,revision FROM qqq_gex_partial_days ORDER BY day";using var p=partial.ExecuteReader();while(p.Read())value.Append(p.GetString(0)).Append(p.GetString(1));}return Hash(value.ToString());
    }
    public string? LatestLocalDate(DateTimeOffset now)
    {
        using var c=Open();using var cmd=c.CreateCommand();cmd.CommandText="SELECT d.day,d.payload,h.sha256 FROM qqq_gex_local_days d JOIN qqq_gex_local_day_hashes h ON d.day=h.day ORDER BY d.day DESC LIMIT 1";using var row=cmd.ExecuteReader();if(!row.Read())return null;if(!Hash(row.GetString(1)).Equals(row.GetString(2),StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Local GEX day integrity failed");return row.GetString(0);
    }
    public static string CanonicalKey(string pathAndQuery)
    {
        var u=new Uri("http://local"+pathAndQuery);
        if(!pathAndQuery.StartsWith("/api/analysis/qqq/",StringComparison.Ordinal)&&!pathAndQuery.StartsWith("/api/proxy/yahoo/history?",StringComparison.Ordinal))throw new ArgumentException("Unsupported GEX route.");
        var pairs=new SortedDictionary<string,string>(StringComparer.Ordinal);
        foreach(var part in u.Query.TrimStart('?').Split('&',StringSplitOptions.RemoveEmptyEntries)){var i=part.IndexOf('=');var key=Uri.UnescapeDataString((i<0?part:part[..i]).Replace('+',' '));var value=Uri.UnescapeDataString((i<0?"":part[(i+1)..]).Replace('+',' '));if(!pairs.TryAdd(key,value))throw new ArgumentException("Duplicate query parameter.");}
        // History client adds page=1 to every GET, including non-paginated resources.
        if(pairs.GetValueOrDefault("page")=="1"&&!u.AbsolutePath.EndsWith("/backtest",StringComparison.Ordinal))pairs.Remove("page");
        return u.AbsolutePath+"|"+JsonSerializer.Serialize(pairs);
    }
    public void Save(string snapshot,string pathAndQuery,Response response)
    {
        if(string.IsNullOrWhiteSpace(snapshot)||string.IsNullOrWhiteSpace(response.Revision)||response.ExpiresAt<=response.AsOf||Encoding.UTF8.GetByteCount(response.Body)>128*1024*1024)throw new ArgumentException("Invalid GEX response metadata.");
        var key=CanonicalKey(pathAndQuery);using var c=Open();using var tx=c.BeginTransaction();using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="INSERT INTO qqq_gex_wire VALUES($snapshot,$key,$type,$body,$revision,$asof,$expires,$hash) ON CONFLICT(snapshot,request_key) DO UPDATE SET content_type=excluded.content_type,body=excluded.body,revision=excluded.revision,as_of=excluded.as_of,expires_at=excluded.expires_at,sha256=excluded.sha256";
        cmd.Parameters.AddWithValue("$snapshot",snapshot);cmd.Parameters.AddWithValue("$key",key);cmd.Parameters.AddWithValue("$type",response.ContentType);cmd.Parameters.AddWithValue("$body",response.Body);cmd.Parameters.AddWithValue("$revision",response.Revision);cmd.Parameters.AddWithValue("$asof",response.AsOf.ToUnixTimeMilliseconds());cmd.Parameters.AddWithValue("$expires",response.ExpiresAt.ToUnixTimeMilliseconds());cmd.Parameters.AddWithValue("$hash",Hash(response.Body));cmd.ExecuteNonQuery();cmd.Parameters.Clear();cmd.CommandText="DELETE FROM qqq_gex_wire WHERE rowid IN (SELECT rowid FROM (SELECT rowid,SUM(length(CAST(body AS BLOB))) OVER (ORDER BY as_of DESC,rowid DESC) AS bytes FROM qqq_gex_wire) WHERE bytes>$cap)";cmd.Parameters.AddWithValue("$cap",capacityBytes);var removed=cmd.ExecuteNonQuery();if(removed>0){cmd.CommandText="SELECT name FROM sqlite_master WHERE name='qqq_gex_import_receipts'";if(cmd.ExecuteScalar() is not null){cmd.CommandText="DELETE FROM qqq_gex_import_receipts";cmd.ExecuteNonQuery();}}tx.Commit();
    }
    public Response? Read(string snapshot,string pathAndQuery,DateTimeOffset now)
    {
        var key=CanonicalKey(pathAndQuery);using var c=Open();using var cmd=c.CreateCommand();cmd.CommandText="SELECT content_type,body,revision,as_of,expires_at,sha256 FROM qqq_gex_wire WHERE snapshot=$snapshot AND request_key=$key";cmd.Parameters.AddWithValue("$snapshot",snapshot);cmd.Parameters.AddWithValue("$key",key);using var r=cmd.ExecuteReader();if(!r.Read()||now.ToUnixTimeMilliseconds()>=r.GetInt64(4))return null;var body=r.GetString(1);if(Hash(body)!=r.GetString(5))throw new InvalidDataException("GEX cached response hash mismatch.");return new(r.GetString(0),body,r.GetString(2),DateTimeOffset.FromUnixTimeMilliseconds(r.GetInt64(3)),DateTimeOffset.FromUnixTimeMilliseconds(r.GetInt64(4)));
    }
    /// <summary>Project bounded local date/day resources from protected archives.</summary>
    public Response? ReadLocalDay(string pathAndQuery,DateTimeOffset now)
    {
        var key=CanonicalKey(pathAndQuery);var split=key.IndexOf('|');var route=key[..split];
        var q=JsonSerializer.Deserialize<Dictionary<string,string>>(key[(split+1)..])!;
        if(!q.TryGetValue("from",out var from)||!q.TryGetValue("to",out var to)||!DateTimeOffset.TryParse(from,out var start)||!DateTimeOffset.TryParse(to,out var end)||end<=start)return null;
        if(route!="/api/analysis/qqq/gex/day" && !(route=="/api/analysis/qqq/pcs/backtest"&&q.GetValueOrDefault("stream")=="dates"))return null;
        if(route=="/api/analysis/qqq/pcs/backtest"){
            using var index=Open();using var select=index.CreateCommand();select.CommandText="SELECT day,revision,updated_at FROM qqq_gex_local_days WHERE day >= $from AND day <= $to ORDER BY day LIMIT 50001";select.Parameters.AddWithValue("$from",start.AddDays(-1).ToString("yyyy-MM-dd"));select.Parameters.AddWithValue("$to",end.ToString("yyyy-MM-dd"));using var reader=select.ExecuteReader();var indexedDates=new List<string>();var indexUpdated=DateTimeOffset.MinValue;string? indexRevision=null;while(reader.Read()){if(indexedDates.Count>=50000)throw new InvalidDataException("GEX date index exceeds bounded history");indexedDates.Add(reader.GetString(0));indexRevision=reader.GetString(1);var updated=DateTimeOffset.FromUnixTimeMilliseconds(reader.GetInt64(2));if(updated>indexUpdated)indexUpdated=updated;}return indexRevision is null?null:new("application/json",JsonSerializer.Serialize(new {available=true,range=new {from,to,toExclusive=true},dates=indexedDates}),indexRevision,indexUpdated,indexUpdated.AddDays(30));
        }
        if(end-start>TimeSpan.FromHours(25))return null;
        using var c=Open();using var readTransaction=c.BeginTransaction(deferred:true);using var cmd=c.CreateCommand();cmd.Transaction=readTransaction;cmd.CommandText="SELECT d.day,d.revision,d.payload,d.updated_at,h.sha256 FROM qqq_gex_local_days d JOIN qqq_gex_local_day_hashes h ON d.day=h.day WHERE d.day >= $first AND d.day <= $last ORDER BY d.day";cmd.Parameters.AddWithValue("$first",Meili.Core.Time.MarketClock.ToEastern(start).ToString("yyyy-MM-dd"));cmd.Parameters.AddWithValue("$last",Meili.Core.Time.MarketClock.ToEastern(end.AddTicks(-1)).ToString("yyyy-MM-dd"));
        using var r=cmd.ExecuteReader();var dates=new List<string>();var items=new List<JsonElement>();var bars=new List<JsonElement>();var expiries=new List<JsonElement>();var coverages=new List<JsonElement>();string? revision=null;var latest=DateTimeOffset.MinValue;
        while(r.Read())
        {
            var updated=DateTimeOffset.FromUnixTimeMilliseconds(r.GetInt64(3));
            if(!Hash(r.GetString(2)).Equals(r.GetString(4),StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Local GEX day integrity failed");
            using var doc=JsonDocument.Parse(r.GetString(2));var root=doc.RootElement;var selected=root.GetProperty("rows").EnumerateArray().Where(x=>DateTimeOffset.Parse(x.GetProperty("capturedAt").GetString()!)>=start&&DateTimeOffset.Parse(x.GetProperty("capturedAt").GetString()!)<end).ToArray();
            if(selected.Length==0)continue;if(root.TryGetProperty("coverage",out var observedCoverage))coverages.Add(observedCoverage.Clone());dates.Add(r.GetString(0));revision=r.GetString(1);if(updated>latest)latest=updated;
            var expiry=q.GetValueOrDefault("expiryDate")??root.GetProperty("rows").EnumerateArray().Select(x=>x.GetProperty("expiryDate").GetString()).Order().FirstOrDefault();selected=selected.Where(x=>x.GetProperty("expiryDate").GetString()==expiry).ToArray();
            items.AddRange(selected.Select(x=>x.Clone()));expiries.AddRange(root.GetProperty("rows").EnumerateArray().GroupBy(x=>x.GetProperty("expiryDate").GetString()).Select(g=>g.Last().Clone()));
            bars.AddRange(root.GetProperty("bars").EnumerateArray().Where(x=>DateTimeOffset.Parse(x.GetProperty("timestamp").GetString()!)>=start&&DateTimeOffset.Parse(x.GetProperty("timestamp").GetString()!)<end).Select(x=>x.Clone()));
        }
        if(revision is null)return null;
        // Keep only row references until serialization. At most one lossless profile
        // document is hydrated at a time, within the same SQLite read transaction.
        using var buffer=new DayWireBuffer();using(var writer=new Utf8JsonWriter(buffer)){
            writer.WriteStartObject();
            void WriteRows(string name,IEnumerable<JsonElement> rows){writer.WritePropertyName(name);writer.WriteStartArray();foreach(var row in rows){using var owner=new HydratedDocuments();HydrateRow(c,row,owner.Values,readTransaction).WriteTo(writer);}writer.WriteEndArray();}
            WriteRows("items",items);WriteRows("expiries",expiries);
            writer.WritePropertyName("bars");JsonSerializer.Serialize(writer,bars);
            writer.WritePropertyName("coverage");JsonSerializer.Serialize(writer,coverages);
            writer.WriteString("selectedExpiry",q.GetValueOrDefault("expiryDate")??(items.Count>0?items[0].GetProperty("expiryDate").GetString():null));writer.WriteEndObject();
        }
        return new("application/json",Encoding.UTF8.GetString(buffer.WrittenSpan),revision,latest,latest.AddDays(30));
    }
    // Returned buffers are cleared because archive profiles can contain user-retained inputs.
    private sealed class DayWireBuffer:System.Buffers.IBufferWriter<byte>,IDisposable
    {
        private byte[]? bytes=System.Buffers.ArrayPool<byte>.Shared.Rent(16384);private int written;
        public ReadOnlySpan<byte> WrittenSpan=>bytes.AsSpan(0,written);
        public void Advance(int count){if(count<0||bytes is null||count>bytes.Length-written)throw new ArgumentOutOfRangeException(nameof(count));written+=count;}
        public Memory<byte> GetMemory(int sizeHint=0){Ensure(sizeHint);return bytes.AsMemory(written);}
        public Span<byte> GetSpan(int sizeHint=0){Ensure(sizeHint);return bytes.AsSpan(written);}
        private void Ensure(int sizeHint){ObjectDisposedException.ThrowIf(bytes is null,this);if(sizeHint<0)throw new ArgumentOutOfRangeException(nameof(sizeHint));sizeHint=Math.Max(1,sizeHint);if(sizeHint<=bytes!.Length-written)return;var next=System.Buffers.ArrayPool<byte>.Shared.Rent(Math.Max(checked(written+sizeHint),checked(bytes.Length*2)));bytes.AsSpan(0,written).CopyTo(next);System.Buffers.ArrayPool<byte>.Shared.Return(bytes,clearArray:true);bytes=next;}
        public void Dispose(){if(bytes is {} buffer){bytes=null;System.Buffers.ArrayPool<byte>.Shared.Return(buffer,clearArray:true);}}
    }
    private sealed class HydratedDocuments:IDisposable{public List<JsonDocument> Values {get;}=[];public void Dispose(){foreach(var document in Values)document.Dispose();}}
    private static JsonElement HydrateRow(SqliteConnection connection,JsonElement row,ICollection<JsonDocument>? retained=null,SqliteTransaction? transaction=null)
    {
        if(!row.TryGetProperty("profileRef",out var reference))return row.Clone();using var command=connection.CreateCommand();command.Transaction=transaction;command.CommandText="SELECT body,sha256 FROM qqq_gex_local_rows WHERE row_key=$key";command.Parameters.AddWithValue("$key",reference.GetString());using var reader=command.ExecuteReader();if(!reader.Read())throw new InvalidDataException("Lossless GEX row missing");var body=QqqGexArchiveBody.DecodeBytes(reader.GetValue(0),16*1024*1024);if(body.Length>16*1024*1024||(!Convert.ToHexString(SHA256.HashData(body)).Equals(reader.GetString(1),StringComparison.OrdinalIgnoreCase)||!row.TryGetProperty("rowSha256",out var expected)||!reader.GetString(1).Equals(expected.GetString(),StringComparison.OrdinalIgnoreCase)))throw new InvalidDataException("Lossless GEX row integrity/bound failed");var document=JsonDocument.Parse(body);try{var value=document.RootElement;if(value.GetProperty("capturedAt").GetString()!=row.GetProperty("capturedAt").GetString()||value.GetProperty("expiryDate").GetString()!=row.GetProperty("expiryDate").GetString())throw new InvalidDataException("Lossless GEX row identity mismatch");if(retained is not null){retained.Add(document);return value;}var result=value.Clone();document.Dispose();return result;}catch{document.Dispose();throw;}
    }
    private static string Hash(string body)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(body)));
}
