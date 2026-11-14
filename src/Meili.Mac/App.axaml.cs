using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Threading;
using Microsoft.Extensions.DependencyInjection;
using Meili.Core.Diagnostics;
using Meili.Core.Settings;
using Meili.Mac.Platform;

namespace Meili.Mac;

public partial class App : Application
{
    private IntPtr _napActivity;

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
            Start(desktop, desktop.Args ?? []);
        base.OnFrameworkInitializationCompleted();
    }

    /// <summary>After the services are built (also used by the headless tests): language, theme and colours.</summary>
    public static void Boot()
    {
        var settings = AppServices.Get<SettingsStore>().Load();
        var loc = AppServices.Get<LocalizationService>();
        loc.Apply(settings.Language);
        var theme = AppServices.Get<MacTheme>();
        theme.ApplyUpDownColors(settings.EffectiveUpDownColors());
        // E1: until the user picks colours, they follow the interface language.
        loc.LanguageChanged += (_, _) => theme.ApplyUpDownColors(AppServices.Get<SettingsStore>().Current.EffectiveUpDownColors(loc.Language));
        theme.Apply(settings.Theme);
    }

    private void Start(IClassicDesktopStyleApplicationLifetime desktop, string[] args)
    {
        var dataDir = MacDataDirectory.Resolve(args, AppContext.BaseDirectory, Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
        Directory.CreateDirectory(dataDir.Path);
        AppServices.DataDirectory = dataDir;
        AppLog.Initialize(dataDir.Path);
        AppLog.Info("app", $"start mac {string.Join(' ', args)} data={dataDir.Path} ({dataDir.Source}) os={Environment.OSVersion.VersionString}");
        Dispatcher.UIThread.UnhandledException += OnUiException;

        var options = AppLaunchOptions.Parse(args);
        var services = new ServiceCollection();
        services.AddSingleton(options);
        MacComposition.Register(services, dataDir);
        AppServices.Provider = services.BuildServiceProvider();
        Boot();

        var window = new MainWindow();
        desktop.MainWindow = window;
        MacMenu.Install(this, window, desktop);
        desktop.ShutdownRequested += (_, _) => window.AllowClose();
        desktop.Exit += (_, e) => OnExit(e.ApplicationExitCode);
        // Dock icon click with no visible window: bring the hidden main window back (Mac convention).
        if (TryGetFeature(typeof(IActivatableLifetime)) is IActivatableLifetime activatable)
            activatable.Activated += (_, e) => { if (e.Kind == ActivationKind.Reopen) window.ShowFromDock(); };
        window.Show();
        SharedComposition.OnStarted(AppServices.Provider);
        if (options.Smoke)
            Dispatcher.UIThread.Post(async () => await PackageSmokeAsync(window, desktop, options), DispatcherPriority.Background);
        // App Nap would delay alert polling by minutes while the window is hidden or covered.
        if (!options.NoAlerts && OperatingSystem.IsMacOS())
            _napActivity = MacNative.BeginActivity("Price alert monitoring");
    }

    private static async Task PackageSmokeAsync(MainWindow window, IClassicDesktopStyleApplicationLifetime desktop, AppLaunchOptions options)
    {
        var failures = new List<string>();
        try
        {
            window.Navigate(AppPage.Settings);
            await Task.Delay(500);
            var settings = AppServices.Get<SettingsViewModel>();
            if (window.CurrentPage != AppPage.Settings || !settings.CanConnectAi) throw new InvalidOperationException("Settings/automation bundle unavailable");
            if (window.CurrentView?.FindControl<Button>("ConnectCodex")?.IsEnabled != true) throw new InvalidOperationException("Connect button not enabled");
            await settings.CopyCodexCommand.ExecuteAsync(null);
            var clipboard = await Avalonia.Input.Platform.ClipboardExtensions.TryGetTextAsync(window.Clipboard!);
            if (clipboard != Meili.Automation.McpConnectionSetup.Bundled(AppContext.BaseDirectory, AppServices.DataDirectory.Path).CodexSetupCommand)
                throw new InvalidOperationException("Clipboard connection command mismatch");
            if (window.CurrentView?.FindControl<Button>("ConnectClaude")?.IsEnabled != true) throw new InvalidOperationException("Claude button not enabled");
            await settings.CopyClaudeCommand.ExecuteAsync(null);
            if (await Avalonia.Input.Platform.ClipboardExtensions.TryGetTextAsync(window.Clipboard!) != Meili.Automation.McpConnectionSetup.Bundled(AppContext.BaseDirectory, AppServices.DataDirectory.Path).ClaudeSetupCommand) throw new InvalidOperationException("Claude setup command mismatch");
            if (LocalizationService.Current["Set_AiTitle"] == "Set_AiTitle") throw new InvalidOperationException("Missing connection resources");
            window.Navigate(AppPage.Charts);
            var deadline = DateTimeOffset.UtcNow.AddSeconds(25);
            var chart = window.CurrentView?.FindControl<WebChartControl>("Chart");
            while (chart?.LastDiagnostic is null && DateTimeOffset.UtcNow < deadline) await Task.Delay(100);
            using var diagnostic = System.Text.Json.JsonDocument.Parse(chart?.LastDiagnostic ?? "{}");
            if (!diagnostic.RootElement.TryGetProperty("status", out var status) || status.GetString() != "rendered") throw new InvalidOperationException("Packaged WebView chart did not render: " + chart?.LastDiagnostic);
            window.Navigate(AppPage.Settings);
            var db = AppServices.Get<Meili.Data.Cache.MarketDb>();
            if (db.ReadSchemaVersion() != Meili.Data.Cache.MarketDb.SchemaVersion) throw new InvalidOperationException("Native SQLite unavailable");
        }
        catch (Exception ex) { AppLog.Error("package-smoke", "Packaged desktop self-check failed", ex); failures.Add(ex.ToString()); }
        var report = options.SmokeReport ?? Path.Combine(AppServices.DataDirectory.Path, "logs", "smoke.json");
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(report))!);
        await File.WriteAllTextAsync(report, System.Text.Json.JsonSerializer.Serialize(new { Failures = failures.Count, Errors = failures, Checks = new[] { "real_window", "settings", "bundled_automation", "clipboard", "resources", "sqlite", "packaged_webview_chart" }, Architecture = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString() }));
        window.AllowClose();
        desktop.Shutdown(failures.Count == 0 ? 0 : 1);
    }

    private static void OnUiException(object? sender, DispatcherUnhandledExceptionEventArgs e)
    {
        // Handled first and no modal dialog: the in-app banner cannot re-enter this handler or pump a nested loop.
        e.Handled = true;
        try
        {
            var log = Path.Combine(AppServices.DataDirectory?.Path ?? AppContext.BaseDirectory, "logs");
            Directory.CreateDirectory(log);
            File.AppendAllText(Path.Combine(log, "crash.log"), $"[{DateTime.Now:O}] {e.Exception}{Environment.NewLine}{Environment.NewLine}");
            AppLog.Error("app", "unhandled UI exception (see crash.log)", e.Exception);
            AppServices.Get<MacNotifier>().ShowError(e.Exception.Message);
        }
        catch (Exception ex)
        {
            AppLog.Error("app", "could not record an unhandled UI exception", ex);
        }
    }

    private void OnExit(int code)
    {
        if (_napActivity != IntPtr.Zero) MacNative.EndActivity(_napActivity);
        AppServices.Get<AlertMonitor>().Dispose();   // only stops its subscription; nothing to fail
        try { AppServices.Get<IvAlertSampler>().Dispose(); AppServices.Get<AlertStore>().Flush(); }
        catch (Exception ex) { AppLog.Warn("app", "alert state flush failed", ex); }
        AppLog.Info("app", $"exit code {code}");
        (AppServices.Provider as IDisposable)?.Dispose();
    }
}
