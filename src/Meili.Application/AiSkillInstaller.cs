using System.Reflection;
using System.Text;

namespace Meili.Automation;

public sealed class SkillInstallConflictException(string message) : IOException(message);

public static class AiSkillInstaller
{
    public const string SkillName = "easysellput-local";
    public static string Content
    {
        get
        {
            using var stream = typeof(AiSkillInstaller).Assembly.GetManifestResourceStream("EasySellPut.Skill") ?? throw new InvalidOperationException("Bundled skill missing.");
            using var reader = new StreamReader(stream);
            return reader.ReadToEnd().Replace("\r\n", "\n");
        }
    }

    public static string ClientFolder(string client) => client switch
    {
        "codex" => ".agents",
        "claude-code" => ".claude",
        _ => throw new ArgumentException("client must be codex or claude-code.")
    };

    // The CLI caller chooses user profile or an explicitly supplied project. MCP never exposes this installer.
    public static object Install(string client, string root)
    {
        var folder = ClientFolder(client);
        var destination = Path.GetFullPath(root);
        foreach (var segment in new[] { folder, "skills", SkillName })
        {
            destination = Path.Combine(destination, segment);
            if (Directory.Exists(destination) && (File.GetAttributes(destination) & FileAttributes.ReparsePoint) != 0)
                throw new SkillInstallConflictException("Skill destination contains a symbolic link; choose a regular project directory or install manually.");
            Directory.CreateDirectory(destination);
        }
        var target = Path.Combine(destination, "SKILL.md");
        var content = Content;
        if (File.Exists(target))
        {
            if ((File.GetAttributes(target) & FileAttributes.ReparsePoint) != 0) throw new SkillInstallConflictException("Existing skill is a symbolic link.");
            if (File.ReadAllText(target).Replace("\r\n", "\n") != content) throw new SkillInstallConflictException("A different easysellput-local skill already exists. Back it up or remove it explicitly before installing.");
            return new { client, skill = SkillName, path = target, status = "already_installed" };
        }
        var temporary = Path.Combine(destination, ".install-" + Guid.NewGuid().ToString("N"));
        try
        {
            File.WriteAllText(temporary, content, new UTF8Encoding(false));
            File.Move(temporary, target, overwrite: false);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
        return new { client, skill = SkillName, path = target, status = "installed" };
    }
}
