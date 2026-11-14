using Meili.Automation;
namespace Meili.Automation.Tests;
public sealed class AiSkillInstallerTests:IDisposable
{
    private readonly string _root=Path.Combine(Path.GetTempPath(),"meili skill ' "+Guid.NewGuid().ToString("N"));
    [Theory]
    [InlineData("codex",".agents")]
    [InlineData("claude-code",".claude")]
    public void Installs_embedded_skill_idempotently_and_never_replaces_different_content(string client,string folder)
    {
        var first=WireJson.Element(AiSkillInstaller.Install(client,_root));Assert.Equal("installed",first.GetProperty("status").GetString());
        var target=Path.Combine(_root,folder,"skills",AiSkillInstaller.SkillName,"SKILL.md");Assert.Equal(AiSkillInstaller.Content,File.ReadAllText(target));
        Assert.Contains("name: easysellput-local",AiSkillInstaller.Content);Assert.Contains("--allow-writes",AiSkillInstaller.Content);
        Assert.Equal("already_installed",WireJson.Element(AiSkillInstaller.Install(client,_root)).GetProperty("status").GetString());
        File.WriteAllText(target,"user-owned");Assert.Throws<SkillInstallConflictException>(()=>AiSkillInstaller.Install(client,_root));Assert.Equal("user-owned",File.ReadAllText(target));
    }
    [Fact]
    public void Embedded_skill_covers_every_catalog_tool_with_matching_access()
    {
        var content=AiSkillInstaller.Content;
        var section=content.Split("<!-- mcp-tool-guide:start -->")[1].Split("<!-- mcp-tool-guide:end -->")[0];
        var rows=section.Split('\n').Where(line=>line.StartsWith("| `",StringComparison.Ordinal)).ToArray();
        Assert.Equal(OperationCatalog.All.Count,rows.Length);
        foreach(var operation in OperationCatalog.All)
        {
            var prefix=$"| `{operation.Name}` | {(operation.Writes ? "write" : "read")} | ";
            Assert.Single(rows,line=>line.StartsWith(prefix,StringComparison.Ordinal));
        }
    }
    [Fact]
    public void Unknown_client_cannot_choose_a_destination()
    {
        Assert.Throws<ArgumentException>(()=>AiSkillInstaller.Install("../other",_root));Assert.False(Directory.Exists(_root));
    }
    private sealed class UnixLinkFactAttribute : FactAttribute
    {
        public UnixLinkFactAttribute() { if (OperatingSystem.IsWindows()) Skip = "Symlink creation privileges depend on Windows host policy; content-conflict tests run on all OSes."; }
    }
    [UnixLinkFact]
    public void Existing_skill_link_is_not_followed()
    {
        var destination=Path.Combine(_root,".agents","skills",AiSkillInstaller.SkillName);Directory.CreateDirectory(destination);
        var outside=Path.Combine(_root,"owned");File.WriteAllText(outside,"untouched");File.CreateSymbolicLink(Path.Combine(destination,"SKILL.md"),outside);
        Assert.Throws<SkillInstallConflictException>(()=>AiSkillInstaller.Install("codex",_root));Assert.Equal("untouched",File.ReadAllText(outside));
    }
    public void Dispose(){if(Directory.Exists(_root))Directory.Delete(_root,true);}
}
