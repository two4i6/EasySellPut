using Microsoft.Data.Sqlite;
using System.Text;
namespace Meili.Data.Cache;
public sealed partial class QqqGexResponseStore
{
    // Explicit maintenance only. Each bounded batch commits independently; a killed
    // process leaves mixed TEXT/gzip records readable and the next call resumes.
    private void ReencodeLegacyArchives()
    {
        using var connection=Open();
        foreach(var (table,key,hashColumn) in new[]{("qqq_gex_local_rows","row_key","sha256"),("qqq_gex_observed_inputs","identity","body_sha256"),("qqq_gex_raw","sha256","sha256")})
        {
            using var exists=connection.CreateCommand();exists.CommandText="SELECT name FROM sqlite_master WHERE name=$table";exists.Parameters.AddWithValue("$table",table);if(exists.ExecuteScalar() is null)continue;
            while(true){var changed=0;using var transaction=connection.BeginTransaction();
                for(var i=0;i<32;i++){
                    using var select=connection.CreateCommand();select.Transaction=transaction;select.CommandText=$"SELECT {key},body,{hashColumn} FROM {table} WHERE typeof(body)='text' AND body NOT LIKE '@observed-v1:%' LIMIT 1";string identity,body,expected;using(var row=select.ExecuteReader()){if(!row.Read())break;identity=row.GetString(0);body=row.GetString(1);expected=row.GetString(2);}if(Encoding.UTF8.GetByteCount(body)>128*1024*1024||!Hash(body).Equals(expected,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Legacy GEX archive hash mismatch; original bytes left intact");
                    object encoded=QqqGexArchiveBody.Encode(Encoding.UTF8.GetBytes(body));
                    if(table=="qqq_gex_raw"){
                        using var schema=connection.CreateCommand();schema.Transaction=transaction;schema.CommandText="SELECT name FROM sqlite_master WHERE name='qqq_gex_observed_inputs'";if(schema.ExecuteScalar() is not null){schema.CommandText="SELECT identity FROM qqq_gex_observed_inputs WHERE body_sha256=$hash LIMIT 1";schema.Parameters.AddWithValue("$hash",expected.ToUpperInvariant());if(schema.ExecuteScalar() is string reference){var original=ReadObservedInput(reference);if(!Hash(original).Equals(expected,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Observed archive reference mismatch");encoded="@observed-v1:"+reference;}}
                    }
                    using var update=connection.CreateCommand();update.Transaction=transaction;update.CommandText=$"UPDATE {table} SET body=$body WHERE {key}=$id AND {hashColumn}=$hash";update.Parameters.AddWithValue("$body",encoded);update.Parameters.AddWithValue("$id",identity);update.Parameters.AddWithValue("$hash",expected);update.ExecuteNonQuery();changed++;
                }
                transaction.Commit();if(changed==0)break;
            }
        }
        using(var command=connection.CreateCommand()){
            command.CommandText="SELECT name FROM sqlite_master WHERE name='qqq_gex_provider_raw'";if(command.ExecuteScalar() is null)return;
            command.CommandText="PRAGMA table_info(qqq_gex_provider_raw)";bool encoding=false;using(var columns=command.ExecuteReader()){while(columns.Read())encoding|=columns.GetString(1)=="encoding";}if(!encoding){command.CommandText="ALTER TABLE qqq_gex_provider_raw ADD COLUMN encoding TEXT NOT NULL DEFAULT 'identity'";command.ExecuteNonQuery();}
        }
        while(true){using var transaction=connection.BeginTransaction();using var command=connection.CreateCommand();command.Transaction=transaction;command.CommandText="SELECT sha256,body FROM qqq_gex_provider_raw WHERE encoding='identity' LIMIT 1";string hash;byte[] body;using(var row=command.ExecuteReader()){if(!row.Read()){transaction.Commit();break;}hash=row.GetString(0);body=(byte[])row.GetValue(1);}if(!Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(body)).Equals(hash,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Original provider archive is corrupt; no replacement made");command.CommandText="UPDATE qqq_gex_provider_raw SET body=$body,encoding='gzip-v1' WHERE sha256=$hash AND encoding='identity'";command.Parameters.AddWithValue("$body",QqqGexArchiveBody.Encode(body));command.Parameters.AddWithValue("$hash",hash);command.ExecuteNonQuery();transaction.Commit();}
    }
}
