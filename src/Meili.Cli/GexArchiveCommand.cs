using Meili.Automation;
namespace Meili.Cli;
internal static class GexArchiveCommand
{
    public const string Help="gex-archive migrate|downgrade --source DB --destination NEW_DB [--resume] [--json]\ngex-archive restore --source MIGRATION_DESTINATION --destination NEW_DB [--json]\ngex-archive status --source MIGRATION_DESTINATION [--json]\nExplicit copy-only local maintenance, never MCP. Source is untouched; verified backup retained. No automatic activation or overwrite. Source may keep receiving writes after the snapshot; those later writes remain only in the original. Use a separately chosen data directory for the new archive. Cancel with Ctrl+C, then resume the same source/destination/action. Old-client DML is fenced in v2 archives; never share the original/new directory as an automatic cutover.";
    public static Task<Meili.Data.Cache.GexArchiveMigrationResult> RunAsync(string[] args,CancellationToken ct)
    {
        string? source=null,destination=null;var resume=false;var seen=new HashSet<string>();
        for(var i=2;i<args.Length;i++)
        {
            var key=args[i];if(!seen.Add(key))throw new ArgumentException("Duplicate archive option");
            if(key=="--json")continue;if(key=="--resume"){resume=true;continue;}
            if(key is not ("--source" or "--destination")||++i>=args.Length||args[i].StartsWith("--",StringComparison.Ordinal))throw new ArgumentException(Help);
            if(key=="--source")source=args[i];else destination=args[i];
        }
        if(source is null)throw new ArgumentException("--source required");
        if(args.ElementAtOrDefault(1)=="status"&&(destination is not null||resume))throw new ArgumentException("status does not mutate a destination");
        return new GexArchiveMaintenance().RunAsync(args.ElementAtOrDefault(1)??"",source,destination,resume,ct);
    }
}
