using Meili.Data.Cache;
namespace Meili.Automation;
/// <summary>Explicit local maintenance, like apps/update; never exposed over MCP or automatic app startup.</summary>
public sealed class GexArchiveMaintenance
{
    readonly QqqGexArchiveMigration migration=new();
    public Task<GexArchiveMigrationResult> RunAsync(string action,string source,string? destination,bool resume,CancellationToken ct)=>action switch
    {
        "migrate"=>migration.RunAsync(source,destination??throw new ArgumentException("--destination required"),"brotli-v2",resume,ct),
        "downgrade"=>migration.RunAsync(source,destination??throw new ArgumentException("--destination required"),"gzip-v1",resume,ct),
        "restore"=>resume?throw new ArgumentException("Resume restore using downgrade --source VERIFIED_BACKUP --destination DEST --resume"):migration.RestoreAsync(source,destination??throw new ArgumentException("--destination required"),ct),
        "status"=>Task.FromResult(migration.Status(source)),
        _=>throw new ArgumentException("Unknown gex-archive maintenance action")
    };
}
