using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Meili.Shared.Services;
#if WINDOWS_READER
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Wpf;
using Meili.App.Services;
#else
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Threading;
using Meili.Mac.Platform;
#endif

internal static class Program
{
    private static int _exitCode = 1;
    [STAThread]
    public static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows() && !OperatingSystem.IsMacOS())
        { Console.Error.WriteLine("Native browser smoke requires Windows or macOS."); return 1; }
        _ = new LocalizationService();
#if WINDOWS_READER
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.Startup += async (_, _) => { await Probe(); app.Shutdown(_exitCode); };
        app.Run();
#else
        AppBuilder.Configure<ProbeApp>().UsePlatformDetect().StartWithClassicDesktopLifetime(args);
#endif
        return _exitCode;
    }
#if !WINDOWS_READER
    public sealed class ProbeApp : Application
    {
        public override void Initialize() => Styles.Add(new Avalonia.Themes.Fluent.FluentTheme());
        public override void OnFrameworkInitializationCompleted()
        {
            base.OnFrameworkInitializationCompleted();
            ((IClassicDesktopStyleApplicationLifetime)ApplicationLifetime!).ShutdownMode = ShutdownMode.OnExplicitShutdown;
            Dispatcher.UIThread.Post(async () =>
            {
                await Probe();
                ((IClassicDesktopStyleApplicationLifetime)ApplicationLifetime!).Shutdown(_exitCode);
            });
        }
    }
#endif
    private static async Task Probe()
    {
        using var server = new Pages();
        var directory = Path.Combine(Path.GetTempPath(), "meili-reader-probe-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        Meili.Core.Diagnostics.AppLog.Initialize(directory);
        // The actual reader uses its own temporary profile; never touch a user's browsing data.
        AppServices.DataDirectory = new Meili.Core.Settings.DataDirectoryInfo(directory, Meili.Core.Settings.DataDirectorySource.CommandLine);
        var window = new NewsReaderWindow();
        NewsReaderWindow? reopened = null;
        try
        {
            window.Show();
            window.OpenArticle(server.Url + "one", "Initial");
            await Until(() => window.Title == "Reader One", "first HTML document title");
            window.OpenArticle(server.Url + "two", "Initial two");
            await Until(() => window.Title == "Reader Two", "second HTML document title");
#if WINDOWS_READER
            var web = ((DockPanel)window.Content).Children.OfType<WebView2>().Single();
            web.GoBack();
#else
            var web = ((DockPanel)window.Content!).Children.OfType<NewsWebView>().Single();
            web.Back();
#endif
            await Until(() => window.Title == "Reader One", "back navigation");
#if WINDOWS_READER
            web.GoForward();
#else
            web.Forward();
#endif
            await Until(() => window.Title == "Reader Two", "forward navigation");
            var requests = server.Count;
            web.Reload();
            await Until(() => server.Count > requests && window.Title == "Reader Two", "reload request");
            window.OpenArticle("file:///private/blocked.html", "Blocked");
            await Task.Delay(300);
#if WINDOWS_READER
            if (web.Source?.Scheme != "http") throw new Exception("Blocked URL reached WebView2");
#else
            if (!web.Address.StartsWith(server.Url, StringComparison.Ordinal)) throw new Exception("Blocked URL reached WKWebView");
#endif
            window.OpenArticle(server.Url + "missing", "Missing");
            await Until(() => ((DockPanel)window.Content!).Children.OfType<TextBlock>().Any(t => t.Text == LocalizationService.Current["Reader_Failed"]), "HTTP error message");
            window.Close();
            reopened = new NewsReaderWindow(); reopened.Show();
            reopened.OpenArticle(server.Url + "one", "Reopened");
            await Until(() => reopened.Title == "Reader One", "reader recreation after disposal");
            Console.WriteLine("PASS: native HTML load, document titles, back, forward, reload, protocol blocking, HTTP error and close/reopen.");
            _exitCode = 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            Console.Error.WriteLine($"Title={window.Title}; HTTP fixture requests={server.Count}");
            foreach (var file in Directory.EnumerateFiles(Path.Combine(directory, "logs"), "*.log"))
                Console.Error.WriteLine(await File.ReadAllTextAsync(file));
        }
        finally { reopened?.Close(); window.Close(); }
    }
    private static async Task Until(Func<bool> condition, string description)
    {
        var deadline = DateTime.UtcNow.AddSeconds(45);
        while (!condition())
        {
            if (DateTime.UtcNow >= deadline) throw new TimeoutException(description);
            await Task.Delay(100);
        }
    }
    private sealed class Pages : IDisposable
    {
        private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
        private readonly CancellationTokenSource _stop = new();
        private int _count;
        public int Count => Volatile.Read(ref _count);
        public string Url { get; }
        public Pages()
        {
            _listener.Start(); Url = $"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}/";
            _ = Serve();
        }
        private async Task Serve()
        {
            try
            {
                while (!_stop.IsCancellationRequested)
                {
                    var client = await _listener.AcceptTcpClientAsync(_stop.Token);
                    _ = Respond(client);
                }
            }
            catch (OperationCanceledException) { } // expected: fixture shutdown
        }
        private async Task Respond(TcpClient client)
        {
            using (client)
            try
            {
                    using var stream = client.GetStream();
                    using var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true);
                    var line = await reader.ReadLineAsync(_stop.Token);
                    while (!string.IsNullOrEmpty(await reader.ReadLineAsync(_stop.Token))) { }
                    var path = line?.Split(' ').ElementAtOrDefault(1);
                    Interlocked.Increment(ref _count);
                    var body = Encoding.UTF8.GetBytes($"<html><head><title>Reader {(path == "/one" ? "One" : "Two")}</title></head><body>Native engine fixture</body></html>");
                    var header = Encoding.ASCII.GetBytes($"HTTP/1.1 {(path == "/missing" ? "404 Not Found" : "200 OK")}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {body.Length}\r\nConnection: close\r\n\r\n");
                    await stream.WriteAsync(header, _stop.Token); await stream.WriteAsync(body, _stop.Token);
            }
            catch (OperationCanceledException) { } // expected: fixture shutdown
            catch (IOException) { } // expected: browser may abandon speculative connections
        }
        public void Dispose() { _stop.Cancel(); _listener.Stop(); _stop.Dispose(); }
    }
}
