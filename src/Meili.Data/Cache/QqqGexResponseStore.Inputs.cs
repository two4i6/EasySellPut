using System.Text.Json.Nodes;
namespace Meili.Data.Cache;
public sealed partial class QqqGexResponseStore
{
    public string RecordProviderBody(string source,ReadOnlyMemory<byte> body,DateTimeOffset asOf,DateTimeOffset fetchedAt)
    {
        if(body.Length is 0 or >134217728)throw new ArgumentException("Provider body is outside bounds");
        var hash=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(body.Span));using var c=Open();using var cmd=c.CreateCommand();cmd.CommandText="CREATE TABLE IF NOT EXISTS qqq_gex_provider_raw(sha256 TEXT PRIMARY KEY,source TEXT NOT NULL,as_of INTEGER NOT NULL,fetched_at INTEGER NOT NULL,body BLOB NOT NULL)";cmd.ExecuteNonQuery();cmd.CommandText="INSERT OR IGNORE INTO qqq_gex_provider_raw VALUES($hash,$source,$asof,$fetched,$body)";cmd.Parameters.AddWithValue("$hash",hash);cmd.Parameters.AddWithValue("$source",source);cmd.Parameters.AddWithValue("$asof",asOf.ToUnixTimeMilliseconds());cmd.Parameters.AddWithValue("$fetched",fetchedAt.ToUnixTimeMilliseconds());cmd.Parameters.AddWithValue("$body",body.ToArray());cmd.ExecuteNonQuery();return hash;
    }
    public bool HasObservedInput()
    {
        using var c=Open();using var cmd=c.CreateCommand();foreach(var table in new[]{"qqq_gex_observed_inputs","qqq_gex_raw"}){cmd.CommandText="SELECT name FROM sqlite_master WHERE name=$name";cmd.Parameters.Clear();cmd.Parameters.AddWithValue("$name",table);if(cmd.ExecuteScalar() is null)continue;cmd.CommandText="SELECT 1 FROM "+table+" LIMIT 1";if(cmd.ExecuteScalar() is not null)return true;}return false;
    }
    public string ReadObservedInput(string identity)
    {
        using var c=Open();using var cmd=c.CreateCommand();cmd.CommandText="SELECT body,body_sha256 FROM qqq_gex_observed_inputs WHERE identity=$id";cmd.Parameters.AddWithValue("$id",identity);using var row=cmd.ExecuteReader();if(!row.Read())throw new InvalidDataException("Observed input disappeared");var body=row.GetString(0);if(Hash(body)!=row.GetString(1))throw new InvalidDataException("Observed input integrity failed");return body;
    }
    /// <summary>Retain first observed normalized input independently of page-publication success.</summary>
    public string RecordObservedInput(string body)
    {
        if(System.Text.Encoding.UTF8.GetByteCount(body)>128*1024*1024)throw new ArgumentException("Input exceeds 128 MB");
        var semantic=JsonNode.Parse(body)!.AsObject();semantic.Remove("receivedAt");semantic.Remove("evaluationAt");
        if(semantic["marketInputs"]?["daily"] is JsonObject daily)foreach(var entry in daily)entry.Value?.AsObject().Remove("fetchedAt");
        foreach(var capture in semantic["captures"]!.AsArray())capture?["result"]?.AsObject().Remove("receivedAt");
        if(semantic["provenance"] is JsonArray provenance)foreach(var row in provenance)row?.AsObject().Remove("FetchedAt");
        if(semantic["barMetadata"] is JsonObject bars)bars.Remove("FetchedAt");
        var identity=Hash(semantic.ToJsonString());using var c=Open();using var cmd=c.CreateCommand();
        cmd.CommandText="CREATE TABLE IF NOT EXISTS qqq_gex_observed_inputs(identity TEXT PRIMARY KEY,received_at INTEGER NOT NULL,body_sha256 TEXT NOT NULL,body TEXT NOT NULL)";cmd.ExecuteNonQuery();
        cmd.CommandText="INSERT OR IGNORE INTO qqq_gex_observed_inputs VALUES($id,$at,$hash,$body)";cmd.Parameters.AddWithValue("$id",identity);cmd.Parameters.AddWithValue("$at",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());cmd.Parameters.AddWithValue("$hash",Hash(body));cmd.Parameters.AddWithValue("$body",body);cmd.ExecuteNonQuery();return identity;
    }
}
