using System.Text.Json;

namespace Meili.Automation;

/// <summary>Read-only stdio connection templates. Never executes commands or edits a client's configuration.</summary>
public sealed record McpConnectionSetup(string Executable, string DataDirectory, bool Windows)
{
    public string[] Arguments => ["mcp", "serve", "--data-dir", DataDirectory];
    public string Json => JsonSerializer.Serialize(new { mcpServers = new Dictionary<string, object> { ["easysellput"] = new { command = Executable, args = Arguments } } }, new JsonSerializerOptions { WriteIndented = true });
    public string Toml => "[mcp_servers.easysellput]\ncommand = " + TomlString(Executable) + "\nargs = [" + string.Join(", ", Arguments.Select(TomlString)) + "]" + "\n";
    private static string TomlString(string value) => System.Text.RegularExpressions.Regex.Replace(JsonSerializer.Serialize(value),
        @"\\u([dD][89aAbB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})", match =>
        {
            var high = Convert.ToInt32(match.Groups[1].Value, 16); var low = Convert.ToInt32(match.Groups[2].Value, 16);
            return "\\U" + char.ConvertToUtf32((char)high, (char)low).ToString("X8");
        });
    public string CodexCommand => "codex mcp add easysellput -- " + string.Join(" ", new[] { Executable }.Concat(Arguments).Select(Quote));
    private string Quote(string value) => "'" + value.Replace("'", Windows ? "''" : "'\"'\"'") + "'";
    public static McpConnectionSetup Bundled(string baseDirectory, string dataDirectory) => new(
        Path.GetFullPath(Path.Combine(baseDirectory, "automation", OperatingSystem.IsWindows() ? "easysellput.exe" : "easysellput")),
        Path.GetFullPath(dataDirectory), OperatingSystem.IsWindows());
}
