using System.Text.Json;
using Meili.Core.Settings;

namespace Meili.Core.Tests;

public sealed class SnapshotConcurrencyTests
{
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
