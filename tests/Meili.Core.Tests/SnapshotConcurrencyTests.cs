using System.Text.Json;
using Meili.Core.Settings;

namespace Meili.Core.Tests;

public sealed class SnapshotConcurrencyTests
{
    [Fact]
    public void Byte_limits_reject_oversized_snapshots_without_replacing_valid_content()
    {
        var directory = Path.Combine(Path.GetTempPath(), "snapshot-bound-" + Guid.NewGuid());
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "snapshot.json");
        try
        {
            File.WriteAllText(path, "abc");
            var bounded = new SnapshotFile(path, maxBytes: 3);
            Assert.Equal("abc", bounded.Read());
            Assert.Throws<InvalidDataException>(() => bounded.Write("abcd"));
            Assert.Equal("abc", new SnapshotFile(path).Read());
            bounded.Write("xyz");
            Assert.Equal("xyz", bounded.Read());
            File.WriteAllText(path, "oversized");
            Assert.Throws<InvalidDataException>(() => new SnapshotFile(path, maxBytes: 3));
            Assert.Equal("oversized", new SnapshotFile(path).Read());
        }
        finally { Directory.Delete(directory, recursive: true); }
    }

    [Fact]
    public void Read_only_snapshots_do_not_create_directories_or_writer_metadata()
    {
        var directory = Path.Combine(Path.GetTempPath(), "snapshot-read-only-" + Guid.NewGuid());
        var path = Path.Combine(directory, "snapshot.json");
        Assert.Null(new SnapshotFile(path).Read());
        Assert.False(Directory.Exists(directory));
        Directory.CreateDirectory(directory);
        try
        {
            File.WriteAllText(path, "legacy");
            Assert.Equal("legacy", new SnapshotFile(path).Read());
            Assert.Equal(new[] { path }, Directory.GetFiles(directory));
        }
        finally { Directory.Delete(directory, recursive: true); }
    }

    [Fact]
    public void An_open_reader_keeps_its_bytes_across_multiple_replacements()
    {
        var directory = Path.Combine(Path.GetTempPath(), "snapshot-retained-reader-" + Guid.NewGuid());
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "snapshot.json");
        try
        {
            var writer = new SnapshotFile(path);
            writer.Write("original");
            using (var original = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete))
            {
                writer.Write("second");
                writer.Write("third");
                Assert.Equal("third", new SnapshotFile(path).Read());
                using var reader = new StreamReader(original);
                Assert.Equal("original", reader.ReadToEnd());
            }
        }
        finally { Directory.Delete(directory, recursive: true); }
    }

    [Fact]
    public async Task Publication_survives_a_short_legacy_reader_without_delete_sharing()
    {
        var directory=Path.Combine(Path.GetTempPath(),"snapshot-legacy-reader-"+Guid.NewGuid());
        Directory.CreateDirectory(directory);var path=Path.Combine(directory,"settings.json");
        Task? pending=null;
        try
        {
            var snapshot=new SnapshotFile(path);snapshot.Write("original");
            using(var reader=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read))
            {
                var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                pending=Task.Run(()=>{entered.SetResult();snapshot.Write("updated");});
                await entered.Task;await Task.Delay(100);
                if(OperatingSystem.IsWindows())Assert.False(pending.IsCompleted,"Windows publication must wait for the legacy reader instead of failing.");
                using var text=new StreamReader(reader,leaveOpen:true);Assert.Equal("original",await text.ReadToEndAsync());
            }
            await pending.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Equal("updated",new SnapshotFile(path).Read());
            Assert.Empty(Directory.GetFiles(directory,"*.tmp"));
        }
        finally{if(pending is not null)try{await pending;}catch(IOException){ }Directory.Delete(directory,true);}
    }

    [WindowsFact]
    public async Task Persistent_nonsharing_reader_times_out_without_partial_publication()
    {
        var directory=Path.Combine(Path.GetTempPath(),"snapshot-locked-"+Guid.NewGuid());Directory.CreateDirectory(directory);
        var path=Path.Combine(directory,"settings.json");
        try
        {
            var snapshot=new SnapshotFile(path);snapshot.Write("original");
            using(var reader=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read))
            {
                var failure=await Record.ExceptionAsync(()=>Task.Run(()=>snapshot.Write("updated")).WaitAsync(TimeSpan.FromSeconds(6)));
                Assert.IsType<IOException>(failure);
                using var text=new StreamReader(reader,leaveOpen:true);Assert.Equal("original",await text.ReadToEndAsync());
            }
            Assert.Equal("original",new SnapshotFile(path).Read());Assert.Empty(Directory.GetFiles(directory,"*.tmp"));
        }
        finally{Directory.Delete(directory,true);}
    }

    [WindowsFact]
    public async Task Replacement_retry_rechecks_external_changes_instead_of_overwriting_them()
    {
        var directory=Path.Combine(Path.GetTempPath(),"snapshot-retry-conflict-"+Guid.NewGuid());Directory.CreateDirectory(directory);
        var path=Path.Combine(directory,"settings.json");Task? pending=null;
        try
        {
            var snapshot=new SnapshotFile(path);snapshot.Write("original");
            using(var reader=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite))
            {
                var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                pending=Task.Run(()=>{entered.SetResult();snapshot.Write("updated");});
                await entered.Task;await Task.Delay(100);Assert.False(pending.IsCompleted);
                await File.WriteAllTextAsync(path,"external");
            }
            await Assert.ThrowsAsync<DataConflictException>(()=>pending);
            Assert.Equal("external",new SnapshotFile(path).Read());Assert.Empty(Directory.GetFiles(directory,"*.tmp"));
        }
        finally{if(pending is not null)try{await pending;}catch(IOException){}Directory.Delete(directory,true);}
    }

    [Fact]
    public async Task Readers_observe_complete_snapshots_while_another_writer_replaces_them()
    {
        var directory = Path.Combine(Path.GetTempPath(), "snapshot-sharing-" + Guid.NewGuid());
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "preferences.json");
        try
        {
            static string Body(int revision) => JsonSerializer.Serialize(new { revision, payload = new string((char)('a' + revision % 26), 32768) });
            var writer = new SnapshotFile(path);
            writer.Write(Body(0));
            using var start = new Barrier(3);
            Task Worker(Action action) => Task.Factory.StartNew(action, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
            var tasks = new[]
            {
                Worker(() => { start.SignalAndWait(); for (var i = 1; i <= 100; i++) writer.Write(Body(i)); }),
                Worker(Read), Worker(Read)
            };
            void Read()
            {
                var reader = new SnapshotFile(path);
                start.SignalAndWait();
                for (var i = 0; i < 200; i++)
                {
                    using var value = JsonDocument.Parse(reader.Read()!);
                    var revision = value.RootElement.GetProperty("revision").GetInt32();
                    Assert.InRange(revision, 0, 100);
                    Assert.Equal(new string((char)('a' + revision % 26), 32768), value.RootElement.GetProperty("payload").GetString());
                }
            }
            await Task.WhenAll(tasks);
            using var final = JsonDocument.Parse(new SnapshotFile(path).Read()!);
            Assert.Equal(100, final.RootElement.GetProperty("revision").GetInt32());
            var stale = new SnapshotFile(path);
            writer.Write(Body(101));
            Assert.Throws<DataConflictException>(() => stale.Write(Body(102)));
            using var retained = JsonDocument.Parse(new SnapshotFile(path).Read()!);
            Assert.Equal(101, retained.RootElement.GetProperty("revision").GetInt32());
        }
        finally { Directory.Delete(directory, recursive: true); }
    }
}

internal sealed class WindowsFactAttribute:FactAttribute
{
    public WindowsFactAttribute(){if(!OperatingSystem.IsWindows())Skip="Requires Windows delete-sharing semantics; exercised by both Windows CI targets.";}
}
