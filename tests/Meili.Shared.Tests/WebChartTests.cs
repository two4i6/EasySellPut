using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Meili.Core.Models;
using Meili.Core.Quotes;
using Meili.Core.Settings;
using Meili.Core.Time;
using Meili.Data.Cache;
using Meili.Shared.ViewModels;

namespace Meili.Shared.Tests;

[Collection(nameof(UiPlatformCollection))]
public sealed class WebChartTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "meili-webchart-" + Guid.NewGuid().ToString("N"));
    private readonly ChartsViewModel _vm;
    private readonly ChartPalette _palette;
    public WebChartTests()
    {
        Ui.Platform = new FakeUiPlatform();
        var loc = new LocalizationService();
        var settings = new SettingsStore(_directory);
        var start = new DateTimeOffset(2025, 1, 6, 14, 30, 0, TimeSpan.Zero);
        var data = new PricingSnapshotTests.SnapshotData { Bars = new BarSeries
        {
            Symbol = "AAPL", Interval = BarInterval.Minute5, Source = "fixture",
            Bars = Enumerable.Range(0, 120).Select(i => i == 70 ? Bar.CloseOnly(start.AddMinutes(i * 5), 100 + i, 1000)
                : Bar.FromSource(start.AddMinutes(i * 5), 100 + i, 101 + i, 99 + i, 100.5 + i, 1000)).ToArray(),
        }};
        _vm = new ChartsViewModel(new WatchlistStore(settings), data, loc, new SymbolContext(), settings, new ChartDrawingStore(_directory));
        _palette = ChartPalette.Create(true, new(204,142,138), new(110,170,138), new(201,198,193), new(150,145,136), ThemePalette.Dark);
    }
    [Fact]
    public async Task Daily_bars_do_not_receive_intraday_session_labels()
    {
        await _vm.LoadAsync();
        _vm.Series=new BarSeries{Symbol="AAPL",Interval=BarInterval.Day1,Source="fixture",Bars=_vm.Series!.Bars};
        using var json=JsonDocument.Parse(WebChartSnapshot.Serialize(_vm,_palette));
        Assert.False(json.RootElement.GetProperty("intraday").GetBoolean());
        Assert.All(json.RootElement.GetProperty("rows").EnumerateArray(),r=>Assert.Equal(JsonValueKind.Null,r.GetProperty("session").ValueKind));
    }
    [Fact]
    public async Task Snapshot_preserves_real_prices_indicator_gaps_and_the_same_analytics_values()
    {
        await _vm.LoadAsync();
        using var json = JsonDocument.Parse(WebChartSnapshot.Serialize(_vm, _palette));
        var rows = json.RootElement.GetProperty("rows");
        Assert.Equal(120, rows.GetArrayLength());
        Assert.Equal("Regular", rows[0].GetProperty("session").GetString());
        Assert.Equal("AfterHours", rows[119].GetProperty("session").GetString());
        Assert.Equal(JsonValueKind.Null, rows[70].GetProperty("open").ValueKind);
        Assert.Equal(JsonValueKind.Null, rows[70].GetProperty("high").ValueKind);
        Assert.Equal(JsonValueKind.Null, rows[70].GetProperty("k").ValueKind);
        Assert.Equal(170, rows[70].GetProperty("close").GetDouble());
        Assert.Equal(JsonValueKind.Null, rows[0].GetProperty("ma").ValueKind);
        Assert.Equal(_vm.Snapshot!.Sma[^1], rows[119].GetProperty("ma").GetDouble());
        Assert.Equal(_vm.Snapshot.Macd.Macd[^1], rows[119].GetProperty("macd").GetDouble());
        Assert.Contains("fixture", json.RootElement.GetProperty("key").GetString());
        var theme = json.RootElement.GetProperty("theme");
        Assert.True(theme.GetProperty("dark").GetBoolean());
        Assert.Equal("#30302E", theme.GetProperty("control").GetString());
        Assert.Equal("#4D4C48", theme.GetProperty("border").GetString());
        Assert.Equal("#FAF9F51F", theme.GetProperty("grid").GetString());
        Assert.Equal("#FAF9F5", theme.GetProperty("accent").GetString());
        Assert.Equal("#3A2A28", theme.GetProperty("errorBackground").GetString());
    }
    [Fact]
    public async Task Private_channel_serves_bundled_assets_versions_and_rejects_foreign_origins_and_untyped_events()
    {
        await _vm.LoadAsync();
        using var session = new WebChartSession(_vm); session.Update(_palette);
        using var client = new HttpClient(new HttpClientHandler { UseProxy = false });
        var root = new Uri(session.PageUri, ".");
        using var page = await client.GetAsync(session.PageUri);
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        Assert.Contains("frame-ancestors 'none'", page.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Contains("TradingView", await page.Content.ReadAsStringAsync());
        using var state = JsonDocument.Parse(await client.GetStringAsync(new Uri(root, "state")));
        var version = state.RootElement.GetProperty("version").GetInt64();
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync(new Uri(root, "state?after=" + version))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(new Uri(root, "../state"))).StatusCode);
        using var foreign = new HttpRequestMessage(HttpMethod.Post, new Uri(root, "event")) { Content = new StringContent("{\"kind\":\"attribution\"}", Encoding.UTF8, "application/json") };
        foreign.Headers.Add("Origin", "https://untrusted.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(foreign)).StatusCode);
        using var invalid = new HttpRequestMessage(HttpMethod.Post, new Uri(root, "event")) { Content = new ByteArrayContent(Encoding.UTF8.GetBytes("{\"kind\":\"shell\",\"command\":\"anything\"}")) };
        invalid.Content.Headers.ContentType = new("application/json"); invalid.Headers.Add("Origin", session.Origin);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(invalid)).StatusCode);
        Assert.True(session.IsPageUrl(session.PageUri.AbsoluteUri));
        Assert.False(session.IsPageUrl("https://untrusted.example/"));
        Assert.False(session.IsPageUrl(new Uri(root, "state").AbsoluteUri));
    }
    [Fact]
    public async Task Sidebar_width_is_validated_and_reopened_from_desktop_settings()
    {
        await _vm.LoadAsync();
        using var session = new WebChartSession(_vm);
        session.Update(_palette);
        using var client = new HttpClient(new HttpClientHandler { UseProxy = false });

        async Task<HttpStatusCode> Resize(double width)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(session.PageUri, "event"))
            { Content = new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(new { kind = "resize-sidebar", width })) };
            request.Content.Headers.ContentType = new("application/json");
            request.Headers.Add("Origin", session.Origin);
            using var response = await client.SendAsync(request);
            return response.StatusCode;
        }

        Assert.Equal(HttpStatusCode.BadRequest, await Resize(199));
        Assert.Equal(HttpStatusCode.BadRequest, await Resize(621));
        Assert.Equal(HttpStatusCode.BadRequest, await Resize(414.5));
        Assert.Null(_vm.RightSidebarWidth);
        Assert.Equal(HttpStatusCode.NoContent, await Resize(414));
        Assert.Equal(414, new SettingsStore(_directory).Load().Charts.RightSidebarWidth);

        using var reopened = new WebChartSession(_vm);
        reopened.Update(_palette);
        using var state = JsonDocument.Parse(await client.GetStringAsync(new Uri(reopened.PageUri, "state")));
        Assert.Equal(414, state.RootElement.GetProperty("data").GetProperty("sidebarWidth").GetInt32());
    }

    [Fact]
    public void Two_hour_period_anchors_to_each_extended_and_regular_session()
    {
        DateTimeOffset At(int hour, int minute) => MarketClock.FromEastern(new DateTime(2025, 1, 6, hour, minute, 0));
        var source = new BarSeries { Symbol = "AAPL", Source = "fixture", Interval = BarInterval.Minute30,
            Adjustment = PriceAdjustment.Split,
            Bars = [Bar.CloseOnly(At(9, 0), 100, 1), Bar.CloseOnly(At(9, 30), 101, 2),
                    Bar.CloseOnly(At(10, 0), 102, 3), Bar.CloseOnly(At(11, 30), 103, 4),
                    Bar.CloseOnly(At(15, 30), 104, 5), Bar.CloseOnly(At(16, 0), 105, 6)] };
        var target = ChartsViewModel.ProjectRange(source, ChartRangeKind.Hour2);
        Assert.Equal(BarInterval.Minute30, ChartsViewModel.BuildRequest("AAPL", ChartRangeKind.Hour2).Interval);
        Assert.Equal(BarInterval.Hour2, target.Interval);
        Assert.Equal(new[] { At(8, 0), At(9, 30), At(11, 30), At(15, 30), At(16, 0) }, target.Bars.Select(bar => bar.Time));
        Assert.Equal(102, target.Bars[1].Close);
        Assert.Equal(5, target.Bars[1].Volume);
        Assert.True(target.Bars[1].Incomplete);
        Assert.Equal(source.Adjustment, target.Adjustment);
    }

    [Fact]
    public void Daily_iv_keeps_data_gaps_and_does_not_mix_option_volatility_bases()
    {
        DateTimeOffset Date(int day, int hour) => MarketClock.FromEastern(new DateTime(2025, 1, day, hour, 0, 0));
        var db = new MarketDb(Path.Combine(_directory, "chart-iv.db"));
        db.AddIvSample("AAPL", Date(6, 14), "Iv30", .20, "cboe");
        db.AddIvSample("AAPL", Date(6, 15), "Iv30", .21, "cboe");
        db.AddIvSample("AAPL", Date(7, 15), "AtmNearest30", .26, "derived");
        db.AddIvSample("AAPL", Date(8, 15), "Iv30", .30, "cboe");
        var series = new BarSeries { Symbol = "AAPL", Interval = BarInterval.Day1,
            Bars = Enumerable.Range(6, 3).Select(day => Bar.CloseOnly(Date(day, 9), 100, 1)).ToArray() };
        var iv = VolatilityInsights.RecordedDailyIv(db, series, Date(8, 12));
        Assert.NotNull(iv);
        Assert.Equal("Iv30", iv.Value.Basis);
        Assert.Equal(21, iv.Value.Percent[0], 7);
        Assert.All(iv.Value.Percent.Skip(1), value => Assert.True(double.IsNaN(value)));
    }

    [Fact]
    public async Task Sidebar_indicators_use_aligned_calculations_and_typed_toggles()
    {
        await _vm.LoadAsync();
        using var session = new WebChartSession(_vm);
        session.Update(_palette);
        using var client = new HttpClient(new HttpClientHandler { UseProxy = false });
        async Task<HttpStatusCode> Toggle(string id, string key)
        {
            using var message = new HttpRequestMessage(HttpMethod.Post, new Uri(session.PageUri, "event"))
            { Content = new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(new { kind = "toggle-study", id, key })) };
            message.Content.Headers.ContentType = new("application/json");
            message.Headers.Add("Origin", session.Origin);
            using var response = await client.SendAsync(message);
            return response.StatusCode;
        }

        Assert.Equal(HttpStatusCode.BadRequest, await Toggle("unsupported", _vm.ChartKey));
        Assert.Equal(HttpStatusCode.NoContent, await Toggle("dma", "old"));
        Assert.False(_vm.StudyEnabled("dma"));
        Assert.Equal(HttpStatusCode.NoContent, await Toggle("dma", _vm.ChartKey));
        Assert.True(_vm.StudyEnabled("dma"));
        using var snapshot = JsonDocument.Parse(WebChartSnapshot.Serialize(_vm, _palette));
        var dma = snapshot.RootElement.GetProperty("studies").EnumerateArray().Single(study => study.GetProperty("id").GetString() == "dma");
        Assert.False(dma.GetProperty("overlay").GetBoolean());
        var line = dma.GetProperty("lines")[0].GetProperty("values");
        Assert.Equal(JsonValueKind.Null, line[48].ValueKind);
        Assert.Equal(20, line[49].GetDouble(), 7);
        Assert.Equal(120, line.GetArrayLength());
    }

    [Fact]
    public async Task Chart_quote_channel_tracks_the_selected_symbol_without_revising_the_candles()
    {
        await _vm.LoadAsync();
        var loc = new LocalizationService();
        var data = new PricingSnapshotTests.SnapshotData();
        var context = new SymbolContext();
        context.Set("AAPL");
        var workspace = new MarketWorkspaceViewModel(context, new WatchlistStore(new SettingsStore(_directory)),
            new QuoteHub(data), loc, data);
        using var session = new WebChartSession(_vm, workspace);
        session.Update(_palette);
        using var client = new HttpClient(new HttpClientHandler { UseProxy = false });
        var owner = new object();
        workspace.Activate(owner, watchlistVisible: false);
        try
        {
            using var first = JsonDocument.Parse(await client.GetStringAsync(new Uri(session.PageUri, "quote")));
            Assert.Equal("AAPL", first.RootElement.GetProperty("symbol").GetString());
            Assert.Equal(workspace.Current!.Price, first.RootElement.GetProperty("price").GetString());

            context.Set("NVDA");
            await workspace.RefreshAsync();
            using var next = JsonDocument.Parse(await client.GetStringAsync(new Uri(session.PageUri, "quote")));
            Assert.Equal("NVDA", next.RootElement.GetProperty("symbol").GetString());
            Assert.Equal(workspace.Current!.Source, next.RootElement.GetProperty("source").GetString());
            using var state = await client.GetAsync(new Uri(session.PageUri, "state?after=1"));
            Assert.Equal(HttpStatusCode.NoContent, state.StatusCode);
        }
        finally { workspace.Deactivate(owner); }
    }
    [Fact]
    public async Task Only_current_chart_typed_drawing_gestures_reach_existing_drawing_store()
    {
        await _vm.LoadAsync();
        using var session = new WebChartSession(_vm); session.Update(_palette);
        using var client = new HttpClient(new HttpClientHandler { UseProxy = false });
        using var state = JsonDocument.Parse(WebChartSnapshot.Serialize(_vm, _palette));
        var key = state.RootElement.GetProperty("key").GetString();
        _vm.StartDrawingCommand.Execute(DrawingKind.HorizontalLine);
        async Task Send(string? chartKey, int index)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(session.PageUri, "event"))
            { Content = new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(new { kind = "drawing", key = chartKey, index, price = 123.45 })) };
            request.Headers.Add("Origin", session.Origin); request.Content.Headers.ContentType = new("application/json");
            Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(request)).StatusCode);
        }
        await Send("old-symbol", 2); await Send(key, 999);
        Assert.Empty(_vm.Drawings);
        await Send(key, 2);
        Assert.Equal(123.45, Assert.Single(_vm.Drawings).Price1);
    }
    [Fact]
    public async Task Reload_cancels_the_old_draft_and_old_tool_epoch_cannot_cancel_a_new_tool()
    {
        await _vm.LoadAsync(); _vm.StartDrawingCommand.Execute(DrawingKind.TrendLine);
        _vm.AddDrawingPoint(_vm.Series!.Bars[10].Time,110);Assert.NotNull(_vm.DrawingStart);
        var oldEpoch=_vm.DrawingEpoch;await _vm.LoadAsync();Assert.Null(_vm.DrawingStart);Assert.Null(_vm.DrawMode);Assert.True(_vm.DrawingEpoch>oldEpoch);
        using var session=new WebChartSession(_vm);session.Update(_palette);
        using var json=JsonDocument.Parse(WebChartSnapshot.Serialize(_vm,_palette));var key=json.RootElement.GetProperty("key").GetString();
        _vm.StartDrawingCommand.Execute(DrawingKind.HorizontalLine);
        using var client=new HttpClient(new HttpClientHandler{UseProxy=false});
        using var request=new HttpRequestMessage(HttpMethod.Post,new Uri(session.PageUri,"event")){Content=new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(new{kind="drawing-cancel",key,epoch=oldEpoch,mode="HorizontalLine"}))};
        request.Content.Headers.ContentType=new("application/json");
        request.Headers.Add("Origin",session.Origin);Assert.Equal(HttpStatusCode.NoContent,(await client.SendAsync(request)).StatusCode);
        Assert.Equal(DrawingKind.HorizontalLine,_vm.DrawMode);Assert.Empty(_vm.Drawings);
        // The UI model can switch range before the next serialized WebView snapshot is published.
        _vm.Range=ChartRangeKind.Minute5;
        using var staleRequest=new HttpRequestMessage(HttpMethod.Post,new Uri(session.PageUri,"event")){Content=new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(new{kind="drawing",key,index=10,price=110}))};
        staleRequest.Content.Headers.ContentType=new("application/json");staleRequest.Headers.Add("Origin",session.Origin);
        Assert.Equal(HttpStatusCode.NoContent,(await client.SendAsync(staleRequest)).StatusCode);Assert.Empty(_vm.Drawings);

    }
    public void Dispose() { _vm.Deactivate(); if (Directory.Exists(_directory)) Directory.Delete(_directory, true); }
}
