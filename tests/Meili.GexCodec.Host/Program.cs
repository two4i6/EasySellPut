using Meili.Data.Cache;
var operation=args[0];var bytes=File.ReadAllBytes(args[1]);
if(operation=="encode")File.WriteAllBytes(args[2],QqqGexArchiveBody.Encode(bytes,args[3]));
else if(operation=="decode")File.WriteAllBytes(args[2],QqqGexArchiveBody.DecodeBytes(bytes,128*1024*1024));
else if(operation=="provider")
{
    var store=new QqqGexResponseStore(args[3]);var now=DateTimeOffset.UtcNow;
    var hash=store.RecordProviderBody("synthetic-codec-test",bytes,now,now);
    File.WriteAllBytes(args[2],store.ReadProviderBody(hash));store.ReleaseIdleConnections();Console.WriteLine(hash);
}
else if(operation=="compact")
{
    var store=new QqqGexResponseStore(args[3]);var result=store.Compact();
    File.WriteAllText(args[2],System.Text.Json.JsonSerializer.Serialize(result));store.ReleaseIdleConnections();
}
else if(operation=="day")
{
    var store=new QqqGexResponseStore(args[3]);var response=store.ReadLocalDay("/api/analysis/qqq/gex/day?from=2026-01-02T14:30:00Z&to=2026-01-02T15:30:00Z",DateTimeOffset.UtcNow)??throw new InvalidDataException("Synthetic day missing");
    File.WriteAllText(args[2],response.Body);store.ReleaseIdleConnections();
}
else if(operation=="bench")
{
    var samples=new List<object>();var process=System.Diagnostics.Process.GetCurrentProcess();var loadedRss=process.WorkingSet64;
    for(var i=0;i<3;i++)
    {
        var cpu=process.TotalProcessorTime;var watch=System.Diagnostics.Stopwatch.StartNew();var encoded=QqqGexArchiveBody.Encode(bytes,args[3]);watch.Stop();var encodeWall=watch.Elapsed.TotalMilliseconds;var encodeCpu=(process.TotalProcessorTime-cpu).TotalMilliseconds;
        cpu=process.TotalProcessorTime;watch.Restart();var decoded=QqqGexArchiveBody.DecodeBytes(encoded,128*1024*1024);watch.Stop();
        var decodeWall=watch.Elapsed.TotalMilliseconds;var decodeCpu=(process.TotalProcessorTime-cpu).TotalMilliseconds;
        if(!bytes.AsSpan().SequenceEqual(decoded))throw new InvalidDataException("Benchmark byte mismatch");
        samples.Add(new{trial=i,decodedBytes=bytes.Length,encodedBytes=encoded.Length,encodeWallMs=encodeWall,encodeCpuMs=encodeCpu,decodeWallMs=decodeWall,decodeCpuMs=decodeCpu});
    }
    process.Refresh();File.WriteAllText(args[2],System.Text.Json.JsonSerializer.Serialize(new{runtime=System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,codec=args[3],loadedRssBytes=loadedRss,peakRssBytes=process.PeakWorkingSet64,samples}));
}
else throw new ArgumentException("Unknown test host action");
