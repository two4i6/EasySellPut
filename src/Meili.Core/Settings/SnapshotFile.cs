using System.Security.Cryptography;
using System.Text;

namespace Meili.Core.Settings;

/// <summary>A lost-update error: callers must reload before retrying their edit.</summary>
public sealed class DataConflictException(string path) : IOException($"Local data changed in another process: {path}. Reload before saving.");

/// <summary>Atomic JSON replacement with a cross-process lock and optimistic snapshot check.</summary>
public sealed class SnapshotFile
{
    private readonly string _path;
    private string? _expected;
    public SnapshotFile(string path)
    {
        _path = path;
        _expected = Fingerprint();
    }

    public string? Read()
    {
        if (!File.Exists(_path)) { _expected = null; return null; }
        var bytes = ReadSnapshotBytes();
        _expected = Convert.ToHexString(SHA256.HashData(bytes));
        return Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF');
    }

    public void Write(string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(_path))!);
        using var lease = Acquire();
        if (Fingerprint() != _expected) throw new DataConflictException(_path);
        var temp = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            var bytes = new UTF8Encoding(false).GetBytes(text);
            File.WriteAllBytes(temp, bytes);
            if (File.Exists(_path)) File.Replace(temp, _path, null);
            else File.Move(temp, _path);
            _expected = Convert.ToHexString(SHA256.HashData(bytes));
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    private string? Fingerprint() => File.Exists(_path) ? Convert.ToHexString(SHA256.HashData(ReadSnapshotBytes())) : null;

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
                if (stream.Length > int.MaxValue) throw new IOException("Snapshot exceeds supported byte length");
                var bytes = new byte[(int)stream.Length];
                stream.ReadExactly(bytes);
                return bytes;
            }
            catch (IOException ex) when (OperatingSystem.IsWindows() && (ex.HResult & 0xffff) is 32 or 33 && Environment.TickCount64 < until)
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
