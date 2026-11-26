using System.Security.Cryptography;
using System.Text;

namespace Meili.Core.Settings;

/// <summary>A lost-update error: callers must reload before retrying their edit.</summary>
public sealed class DataConflictException(string path) : IOException($"Local data changed in another process: {path}. Reload before saving.");

/// <summary>Atomic JSON replacement with a cross-process lock and optimistic snapshot check.</summary>
public sealed class SnapshotFile
{
    private readonly string _path;
    private readonly int _maxBytes;
    private readonly Action<string, string> _replace;
    private string? _expected;
    public SnapshotFile(string path) : this(path, int.MaxValue) { }

    public SnapshotFile(string path, int maxBytes) : this(path, maxBytes, static (source, destination) => File.Replace(source, destination, null)) { }

    internal SnapshotFile(string path, int maxBytes, Action<string, string> replace)
    {
        _replace = replace;
        ArgumentOutOfRangeException.ThrowIfNegative(maxBytes);
        _maxBytes = maxBytes;
        _path = path;
        _expected = Fingerprint();
    }

    public string? Read()
    {
        var bytes = LoadSnapshot();
        if (bytes is null) { _expected = null; return null; }
        _expected = Convert.ToHexString(SHA256.HashData(bytes));
        return Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF');
    }

    public void Write(string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(_path))!);
        using var lease = Acquire();
        if (Fingerprint(writeLeaseHeld: true) != _expected) throw new DataConflictException(_path);
        var temp = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            var bytes = new UTF8Encoding(false).GetBytes(text);
            if (bytes.Length > _maxBytes) throw new InvalidDataException("Snapshot exceeds configured byte limit");
            File.WriteAllBytes(temp, bytes);
            var intended = Convert.ToHexString(SHA256.HashData(bytes));
            var until=Environment.TickCount64+3000;var recheck=false;
            while(true)
            {
                // Keep the coordinator and CAS check across transient Windows readers
                // (including older processes without delete sharing).
                if (recheck)
                {
                    if (Fingerprint(writeLeaseHeld: true) != _expected) throw new DataConflictException(_path);
                    if (!File.Exists(temp) || Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(temp))) != intended)
                        throw new InvalidDataException("Staged snapshot changed before replacement retry");
                }
                try
                {
                    if(File.Exists(_path))_replace(temp,_path);
                    else File.Move(temp,_path);
                    break;
                }
                catch(IOException ex)when(((OperatingSystem.IsWindows() && ((ex.HResult & 0xffff) is 32 or 33)) || ex.HResult == unchecked((int)0x80070497)) && Environment.TickCount64<until)
                {recheck=true;Thread.Sleep(5);} // ReplaceFile error 1175 preserves both names; retry only unchanged snapshots.
                // Other partial-replacement errors (1176/1177), permissions and corruption surface.
            }
            _expected = intended;
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    private string? Fingerprint(bool writeLeaseHeld = false)
    {
        var bytes = LoadSnapshot(writeLeaseHeld);
        return bytes is null ? null : Convert.ToHexString(SHA256.HashData(bytes));
    }

    private byte[]? LoadSnapshot(bool writeLeaseHeld = false)
    {
        if (writeLeaseHeld) return File.Exists(_path) ? ReadSnapshotBytes() : null;
        var until = Environment.TickCount64 + 3000;
        while (true)
        {
            using var lease = AcquireRead(until);
            try
            {
                var bytes = File.Exists(_path) ? ReadSnapshotBytes() : null;
                // A first writer may create the coordinator after we found none.
                // Re-read under it rather than publish a replacement-gap absence.
                if (lease is not null || !File.Exists(_path + ".lock")) return bytes;
            }
            catch (FileNotFoundException) when (lease is null && File.Exists(_path + ".lock") && Environment.TickCount64 < until)
            {
                // expected: first publication created its coordinator during our legacy read.
            }
            if (Environment.TickCount64 >= until) throw new IOException("Snapshot coordination deadline exceeded: " + _path);
        }
    }

    private FileStream? AcquireRead(long until)
    {
        while (true)
        {
            try { return new FileStream(_path + ".lock", FileMode.Open, FileAccess.Read, FileShare.Read); }
            catch (FileNotFoundException) { return null; } // expected: legacy/absent data has no writer metadata
            catch (DirectoryNotFoundException) { return null; } // expected: reads never create a profile
            catch (IOException) when (Environment.TickCount64 < until) { Thread.Sleep(5); } // expected: active atomic publisher owns the coordinator
        }
    }

    private byte[] ReadSnapshotBytes()
    {
        // Atomic replacement needs delete sharing on Windows. Keep this handle on
        // the complete old inode/file object if another writer publishes a new one.
        // Do not allow in-place writes; the writer lease and CAS remain unchanged.
        var until = Environment.TickCount64 + 3000;
        while (true)
        {
            try
            {
                using var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
                if (stream.Length > _maxBytes) throw new InvalidDataException("Snapshot exceeds configured byte limit");
                var bytes = new byte[(int)stream.Length];
                stream.ReadExactly(bytes);
                return bytes;
            }
            catch (IOException ex) when (OperatingSystem.IsWindows() && ((ex.HResult & 0xffff) is 32 or 33) && Environment.TickCount64 < until)
            {
                // expected: ReplaceFile briefly owns its replacement handle exclusively.
                // Retry only sharing/lock violations; permission, corruption and expiry surface.
                Thread.Sleep(5);
            }
        }
    }

    private FileStream Acquire()
    {
        var until = DateTime.UtcNow.AddSeconds(3);
        while (true)
        {
            try { return new FileStream(_path + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) when (DateTime.UtcNow < until) { Thread.Sleep(25); } // expected: another local writer owns the lease
        }
    }
}
