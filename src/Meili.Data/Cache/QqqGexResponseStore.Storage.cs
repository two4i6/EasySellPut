namespace Meili.Data.Cache;
public sealed partial class QqqGexResponseStore
{
    public IReadOnlyDictionary<string,long> RetainedStorageBytes()
    {
        using var connection=Open();var sizes=new Dictionary<string,long>();foreach(var (name,table,column) in new[]{("profiles","qqq_gex_local_rows","body"),("observedInputs","qqq_gex_observed_inputs","body"),("providerRaw","qqq_gex_provider_raw","body"),("manualInputs","qqq_gex_raw","body"),("dayMetadata","qqq_gex_local_days","payload"),("partialMetadata","qqq_gex_partial_days","payload")}){using var command=connection.CreateCommand();command.CommandText="SELECT name FROM sqlite_master WHERE name=$table";command.Parameters.AddWithValue("$table",table);if(command.ExecuteScalar() is null){sizes[name]=0;continue;}command.CommandText=$"SELECT COALESCE(SUM(length(CAST({column} AS BLOB))),0) FROM {table}";command.Parameters.Clear();sizes[name]=Convert.ToInt64(command.ExecuteScalar());}return sizes;
    }
    public object StorageHealth()
    {
        try { return ReadStorageHealth(); }
        catch(Exception error) when(error is IOException or InvalidDataException or UnauthorizedAccessException or Microsoft.Data.Sqlite.SqliteException)
        { if(!IsUnavailable)Meili.Core.Diagnostics.AppLog.Warn("qqq-gex","Storage health unavailable: "+error.GetType().Name);if(error is Microsoft.Data.Sqlite.SqliteException sqlite && sqlite.SqliteErrorCode is 11 or 26)storageFailure="sqlite_corrupt";return new {canCapture=false,archiveWarning=true,error="storage_unavailable",policy="Storage cannot be inspected safely; writes paused, original files retained; no automatic reset or deletion"}; }
    }
    private object ReadStorageHealth()
    {
        var sizes=RetainedStorageBytes();var file=new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(connectionString).DataSource;var available=new DriveInfo(Path.GetPathRoot(Path.GetFullPath(file))!).AvailableFreeSpace;using var connection=Open();using var command=connection.CreateCommand();command.CommandText="PRAGMA freelist_count";var pages=Convert.ToInt64(command.ExecuteScalar());command.CommandText="PRAGMA page_size";var pageBytes=Convert.ToInt64(command.ExecuteScalar());return new{wireLimitBytes=capacityBytes,wireImportTargetBytes=48L*1024*1024,retainedBytes=sizes,archiveWarningBytes=QqqGexStoragePolicy.ArchiveWarningBytes,archiveWarning=sizes.Values.Sum()>=QqqGexStoragePolicy.ArchiveWarningBytes,databaseFileBytes=new FileInfo(file).Length,freePageBytes=pages*pageBytes,availableBytes=available,reserveBytes=QqqGexStoragePolicy.ReserveBytes,canCapture=available>=QqqGexStoragePolicy.ReserveBytes,policy="Unique history has no automatic eviction; explicit compact mode preserves decoded hashes and needs temporary space"};
    }
}
