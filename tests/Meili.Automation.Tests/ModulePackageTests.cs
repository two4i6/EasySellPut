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
    private string Package(string path = "engine/main.mjs", bool tamper = false, string repository = "test/source", int api = 1, bool extra = false, string version = "1.0.0")
    {
        Directory.CreateDirectory(root);
        var filename = Path.Combine(root, Guid.NewGuid().ToString("N") + ".espapp");
        var script = Encoding.UTF8.GetBytes("export const value=1;");
        var manifest = new ModuleManifest(1, repository, "easysellput.test", version, api, 1, 1, "node24", path, null,
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

    [Fact]
    public async Task Explicit_install_update_disable_uninstall_and_reinstall_preserve_app_data()
    {
        var profile = Path.Combine(root, "profile");
        var installer = new ModuleInstaller(profile, (file, ct) => Verify(file));
        var a = Package(); var b = Package(version: "1.0.1");
        await installer.InstallAsync(a);
        var data = Path.Combine(profile, "apps", "data", "easysellput.test"); Directory.CreateDirectory(data);
        File.WriteAllText(Path.Combine(data, "history"), "original observations");
        await installer.InstallAsync(b);
        Assert.Equal("1.0.1", (await installer.VerifyInstalledAsync("easysellput.test")).Manifest.Version);
        await Assert.ThrowsAsync<InvalidDataException>(() => installer.InstallAsync(a));
        installer.SetEnabled("easysellput.test", false);
        await Assert.ThrowsAsync<ArgumentException>(() => installer.VerifyInstalledAsync("easysellput.test"));
        installer.SetEnabled("easysellput.test", true);
        Assert.Equal("uninstalled", installer.Uninstall("easysellput.test").Status);
        Assert.Empty(installer.Inspect().State.Apps);
        await installer.InstallAsync(b);
        Assert.Equal("original observations", File.ReadAllText(Path.Combine(data, "history")));
    }

    [Fact]
    public async Task Active_execution_and_invalid_code_cannot_replace_registration()
    {
        var profile = Path.Combine(root, "profile");
        var installer = new ModuleInstaller(profile, (file, ct) => Verify(file));
        await installer.InstallAsync(Package());
        var before = installer.Inspect();
        using (new ModuleRegistry(profile).AcquireExecution("easysellput.test"))
            await Assert.ThrowsAsync<IOException>(() => installer.InstallAsync(Package(version: "1.0.1")));
        await Assert.ThrowsAsync<InvalidDataException>(() => installer.InstallAsync(Package(tamper: true, version: "1.0.2")));
        Assert.Equal(before.Revision, installer.Inspect().Revision);
        Assert.Equal("1.0.0", Assert.Single(installer.Inspect().State.Apps).Version);
    }

    [Fact]
    public async Task Recovery_reconciles_committed_pointer_but_never_activates_an_uncommitted_candidate()
    {
        var profile = Path.Combine(root, "profile");
        var installer = new ModuleInstaller(profile, (file, ct) => Verify(file));
        await installer.InstallAsync(Package());
        var folder = Path.Combine(profile, "apps", "transactions");
        var journal = Directory.GetFiles(folder, "*.json").Single();
        File.WriteAllText(journal, File.ReadAllText(journal).Replace("activated", "staged"));
        var before = installer.Inspect();
        Assert.Equal(1, installer.RecoverPending());
        Assert.Contains("reconciled_active", File.ReadAllText(journal));
        var abandoned = Path.Combine(folder, "uncommitted.json");
        File.WriteAllText(abandoned, JsonSerializer.Serialize(new { schemaVersion = 1, id = "easysellput.test",
            version = "2.0.0", packageSha256 = new string('B', 64), phase = "verified" }));
        Assert.Equal(1, installer.RecoverPending());
        Assert.Contains("abandoned", File.ReadAllText(abandoned));
        Assert.Equal(before.Revision, installer.Inspect().Revision);
        Assert.Equal(0, installer.RecoverPending());
    }

    public void Dispose() { key.Dispose(); if (Directory.Exists(root)) Directory.Delete(root, true); }
}
