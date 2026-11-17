using Meili.Automation;
using Meili.Automation.Modules;

namespace Meili.Cli;

internal static class AppsCommand
{
    public static async Task<object> RunAsync(string[] args, CancellationToken ct)
    {
        var action = args.ElementAtOrDefault(1) ?? "list";
        string? directory = null, package = null, id = null;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 2; i < args.Length; i++)
        {
            var arg = args[i];
            if (arg == "--json") continue;
            if (arg.StartsWith("--", StringComparison.Ordinal))
            {
                var pair = arg.Split('=', 2); var name = pair[0];
                if (!seen.Add(name) || name is not ("--data-dir" or "--package")) throw new ArgumentException("Invalid or duplicate app maintenance option.");
                var value = pair.Length == 2 ? pair[1] : ++i < args.Length ? args[i] : throw new ArgumentException("Missing app maintenance option value.");
                if (string.IsNullOrWhiteSpace(value) || value.StartsWith("--", StringComparison.Ordinal)) throw new ArgumentException("Missing app maintenance option value.");
                if (name == "--data-dir") directory = value; else package = value;
            }
            else if (id is null) id = arg; else throw new ArgumentException("Unexpected app maintenance argument.");
        }
        if (action is not ("list" or "info" or "doctor" or "recover" or "install" or "update" or "enable" or "disable" or "uninstall"))
            throw new ArgumentException("Unknown app maintenance command.");
        var read = action is "list" or "info" or "doctor";
        if (action is "install" or "update")
        { if (package is null || id is not null) throw new ArgumentException("Use apps install|update --package PATH."); }
        else if (package is not null) throw new ArgumentException("This app command does not accept a package.");
        if ((action is "info" or "enable" or "disable" or "uninstall") != (id is not null))
            throw new ArgumentException("This app command requires exactly one app ID.");
        var profile = LocalPaths.Resolve(directory, migrateLegacy: !read);
        var installer = new ModuleInstaller(profile.Path);
        if (action == "list") return installer.Inspect();
        if (action == "recover") return new { status = "recovered", transactions = installer.RecoverPending() };
        if (action == "doctor") return new { profile, trustedRepository = UpdateClient.Repository,
            trustConfigured = UpdateClient.IsConfigured, registry = installer.Inspect(),
            packageVerification = "metadata_only; payload is reverified before execution" };
        if (action == "info") return installer.Inspect().State.Apps.SingleOrDefault(a => a.Id == id)
            ?? throw new ArgumentException("Module is not installed.");
        if (action is "install" or "update") return await installer.InstallAsync(package!, ct, updateOnly: action == "update");
        if (action == "uninstall") return installer.Uninstall(id!);
        return await installer.SetEnabledAsync(id!, action == "enable", ct);
    }
}
