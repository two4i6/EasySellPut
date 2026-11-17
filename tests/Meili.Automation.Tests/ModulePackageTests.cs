using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Meili.Automation.Modules;

namespace Meili.Automation.Tests;

public sealed class ModulePackageTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "esp-modules-" + Guid.NewGuid().ToString("N"));
    private readonly ECDsa key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private string Package(string path = "engine/main.mjs", bool tamper = false, string repository = "test/source", int api = 1, bool extra = false)
    {
        Directory.CreateDirectory(root);
        var filename = Path.Combine(root, Guid.NewGuid().ToString("N") + ".espapp");
        var script = Encoding.UTF8.GetBytes("export const value=1;");
        var manifest = new ModuleManifest(1, repository, "easysellput.test", "1.0.0", api, 1, 1, "node24", path, null,
            ["linux-x64"], [new(path, script.Length, Convert.ToHexString(SHA256.HashData(script)))]);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(manifest, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var zip = ZipFile.Open(filename, ZipArchiveMode.Create);
        void Add(string name, byte[] data) { using var stream = zip.CreateEntry(name).Open(); stream.Write(data); }
        Add("app.json", bytes);
        Add("app.sig", key.SignData(bytes, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence));
        Add(path, tamper ? Encoding.UTF8.GetBytes("export const value=2;") : script);
        if (extra) Add("unlisted.mjs", script);
        return filename;
    }
    private Task<VerifiedModule> Verify(string file, string? publicKey = null) => ModulePackage.VerifyAsync(file,
        publicKey ?? key.ExportSubjectPublicKeyInfoPem(), "test/source", "linux-x64", CancellationToken.None);

    [Fact]
    public async Task Signed_core_only_package_is_validated_without_extraction_or_activation()
    {
        var file = Package();
        var result = await Verify(file);
        Assert.Equal("easysellput.test", result.Manifest.Id);
        Assert.Null(result.Manifest.Ui);
        Assert.Equal(Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(file))), result.PackageSha256);
        Assert.Empty(Directory.GetDirectories(root));
    }
    [Fact]
    public async Task Wrong_key_tampered_code_wrong_source_and_unknown_host_api_are_rejected()
    {
        using var other = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        await Assert.ThrowsAsync<InvalidDataException>(() => Verify(Package(), other.ExportSubjectPublicKeyInfoPem()));
        await Assert.ThrowsAsync<InvalidDataException>(() => Verify(Package(tamper: true)));
        await Assert.ThrowsAsync<InvalidDataException>(() => Verify(Package(repository: "attacker/source")));
        await Assert.ThrowsAsync<InvalidDataException>(() => Verify(Package(api: 2)));
        await Assert.ThrowsAsync<InvalidDataException>(() => Verify(Package(extra: true)));
    }
    [Theory]
    [InlineData("../outside.mjs")]
    [InlineData("/engine/main.mjs")]
    [InlineData("engine\\main.mjs")]
    [InlineData("engine/main.mjs:stream")]
    [InlineData("engine/CON.mjs")]
    [InlineData("engine/../main.mjs")]
    [InlineData("engine/main.mjs.")]
    public async Task Unsafe_cross_platform_paths_are_rejected(string path) =>
        await Assert.ThrowsAsync<InvalidDataException>(() => Verify(Package(path)));

    public void Dispose() { key.Dispose(); if (Directory.Exists(root)) Directory.Delete(root, true); }
}
