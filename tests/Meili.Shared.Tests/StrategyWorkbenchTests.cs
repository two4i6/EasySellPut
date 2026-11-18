using System.Net;
using System.Text;
using System.Text.Json;
using Meili.Analytics;
using Meili.Core.Pricing;
using Meili.Core.Models;
using Meili.Core.Settings;
using Meili.Shared.ViewModels;
using ARight = Meili.Analytics.OptionRight;
using CRight = Meili.Core.Models.OptionRight;

namespace Meili.Shared.Tests;

[Collection(nameof(UiPlatformCollection))]
public sealed class StrategyWorkbenchTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "meili-workbench-" + Guid.NewGuid().ToString("N"));
    private readonly StrategyViewModel _vm;
    private readonly PricingSnapshotTests.SnapshotData _data;
    private readonly ChartPalette _palette;
    private readonly DateOnly _expiry = new(2099, 12, 18);
    public StrategyWorkbenchTests()
    {
        Ui.Platform = new FakeUiPlatform();
        var loc = new LocalizationService();
        var data = new PricingSnapshotTests.SnapshotData { Chain = new OptionChain
        {
            Underlying = "AAPL", UnderlyingPrice = 100, Expiration = _expiry, Expirations = [_expiry], Source = "fixture", DelayMinutes = 15,
            AsOf = DateTimeOffset.UtcNow.AddMinutes(-15),
            Contracts = [Contract("call100",100,2,4),Contract("call110",110,1,2),Contract("missing",120,null,null),Contract("crossed",130,5,4) with { Last = 2 }],
        }};
        _data=data;
        var settings = new SettingsStore(_directory);
        var rates = new RiskFreeRateProvider(data, () => new PricingSettings { RateMode = RiskFreeRateMode.Fixed, FixedRatePercent = 0 });
        _vm = new StrategyViewModel(new WatchlistStore(settings),data,loc,new SymbolContext(),new PricingAssumptions(data,rates),new StrategyStore(_directory),settings);
        _vm.SymbolText = "AAPL";
        _vm.SelectedPreset = _vm.Presets.First(p => p.Kind == StrategyKind.Custom);
        _palette = ChartPalette.Create(true,new(204,142,138),new(110,170,138),new(201,198,193),new(160,155,146),ThemePalette.Dark);
    }
    private OptionContract Contract(string id,double strike,double? bid,double? ask) => new()
    { ContractSymbol=id,Underlying="AAPL",Right=CRight.Call,Strike=strike,Expiration=_expiry,Bid=bid,Ask=ask,ImpliedVolatility=.25 };
    [Fact]
    public async Task Chain_selection_builds_spread_and_quantity_changes_use_existing_analytics_without_replacing_premiums()
    {
        await _vm.LoadAsync();
        Assert.Empty(_vm.Legs);
        Assert.True(_vm.AddWorkbenchContract("call100",PositionSide.Long,1));
        Assert.True(_vm.AddWorkbenchContract("call110",PositionSide.Short,1));
        var strategy = new OptionStrategy([StrategyLeg.Call(PositionSide.Long,100,3,_expiry,1,.25),StrategyLeg.Call(PositionSide.Short,110,1.5,_expiry,1,.25)]);
        Assert.NotNull(_vm.Curve);
        for(var i=0;i<_vm.Curve!.Prices.Length;i++) Assert.Equal(strategy.PnlAtExpiry(_vm.Curve.Prices[i]),_vm.Curve.ExpiryPnl[i],8);
        Assert.Equal(850,_vm.ExpiryAnalysis!.MaxProfit,6);
        Assert.Equal(-150,_vm.ExpiryAnalysis.MaxLoss,6);
        var row=_vm.Legs[0]; var premium=row.PremiumText;
        Assert.True(_vm.EditWorkbenchLeg(row.Id,"quantity",2));
        Assert.Equal(premium,row.PremiumText);
        Assert.Equal("2",row.QtyText);
        row.SetQuotes(999, .35); // A later market refresh changes IV, not the recorded entry cost.
        Assert.Equal(premium,row.PremiumText);
        Assert.True(_vm.WorkbenchGreeks is not null);
        using var payload=JsonDocument.Parse(StrategyWorkbench.Serialize(_vm,_palette));
        Assert.Equal(_vm.WorkbenchGreeks!.Value.Delta,payload.RootElement.GetProperty("greeks").GetProperty("delta").GetDouble());
        Assert.Equal("fixture",payload.RootElement.GetProperty("source").GetString());
        Assert.Equal(15,payload.RootElement.GetProperty("delayMinutes").GetInt32());
    }
    [Fact]
    public async Task Missing_prices_invalid_quantities_and_stale_events_never_mutate_the_draft()
    {
        await _vm.LoadAsync();
        Assert.False(_vm.AddWorkbenchContract("missing",PositionSide.Long,1));
        Assert.False(_vm.AddWorkbenchContract("call100",PositionSide.Long,0));
        Assert.Empty(_vm.Legs);
        Assert.True(_vm.AddWorkbenchContract("call100",PositionSide.Long,1));
        var key=_vm.WorkbenchKey;var row=_vm.Legs[0];var premium=row.PremiumText;
        Assert.True(_vm.EditWorkbenchLeg(row.Id,"quantity",2));
        using var stale=JsonDocument.Parse(JsonSerializer.Serialize(new{kind="edit-leg",key,id=row.Id,field="quantity",quantity=50}));
        Assert.True(StrategyWorkbench.ValidEvent(stale.RootElement));
        StrategyWorkbench.Dispatch(_vm,stale.RootElement);
        Assert.Equal("2",row.QtyText);
        row.SetQuotes(999, .35); // A later market refresh changes IV, not the recorded entry cost.
        Assert.Equal(premium,row.PremiumText);
        Assert.NotEmpty(_vm.WorkbenchMessage);
        Assert.False(_vm.EditWorkbenchLeg(row.Id,"quantity",-1));
        using var invalid=JsonDocument.Parse("""{"kind":"edit-leg","key":"a","id":"not-a-guid","field":"quantity","quantity":2} """);
        Assert.False(StrategyWorkbench.ValidEvent(invalid.RootElement));
        _vm.ClearWorkbench();Assert.Empty(_vm.Legs);Assert.False(_vm.HasCurve);
    }
    [Fact]
    public async Task Workspace_document_and_typed_events_run_over_the_same_private_channel()
    {
        await _vm.LoadAsync();
        using var session=new WebChartSession(_vm);session.Update(_palette);
        using var client=new HttpClient(new HttpClientHandler{UseProxy=false});
        var html=await client.GetStringAsync(session.PageUri);
        Assert.Contains("workbench.js",html);Assert.DoesNotContain("script src=\"library.js",html);
        using var request=new HttpRequestMessage(HttpMethod.Post,new Uri(session.PageUri,"event"))
        {Content=new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(new{kind="add-contract",key=_vm.WorkbenchKey,contract="crossed",side="Short",quantity=1}))};
        request.Headers.Add("Origin",session.Origin);request.Content.Headers.ContentType=new("application/json");
        Assert.Equal(HttpStatusCode.NoContent,(await client.SendAsync(request)).StatusCode);
        Assert.Equal("2",Assert.Single(_vm.Legs).PremiumText);
    }
    [Fact]
    public async Task Changing_underlying_keeps_old_draft_identity_and_saves_it_under_its_actual_symbol()
    {
        await _vm.LoadAsync();Assert.True(_vm.AddWorkbenchContract("call100",PositionSide.Long,1));
        _data.Chain=_data.Chain with{Underlying="MSFT",Contracts=_data.Chain.Contracts.Select(c=>c with{Underlying="MSFT"}).ToArray()};
        _vm.SymbolText="MSFT";await _vm.LoadAsync(refreshOnly:true);
        Assert.False(_vm.WorkbenchSymbolMatches);
        Assert.False(_vm.HasCurve);
        Assert.False(_vm.AddWorkbenchContract("call110",PositionSide.Long,1));
        using var json=JsonDocument.Parse(StrategyWorkbench.Serialize(_vm,_palette));
        Assert.Empty(json.RootElement.GetProperty("curve").EnumerateArray());
        _vm.SaveName="old draft";await _vm.SaveStrategyCommand.ExecuteAsync(null);
        Assert.Equal("AAPL",Assert.Single(new StrategyStore(_directory).All).Symbol);
        _vm.ClearWorkbench();Assert.True(_vm.AddWorkbenchContract("call110",PositionSide.Long,1));
        Assert.Equal("MSFT",_vm.WorkbenchDraftSymbol);
    }
    [Fact] public async Task Explicit_quote_side_keeps_observed_bid_ask_and_rejects_crossed_or_wrong_side()
    {
        await _vm.LoadAsync();Assert.True(_vm.AddWorkbenchContract("call100",PositionSide.Long,1,"ask"));
        Assert.Equal(4,double.Parse(_vm.Legs[0].PremiumText,System.Globalization.CultureInfo.InvariantCulture));
        Assert.True(_vm.AddWorkbenchContract("call110",PositionSide.Short,1,"bid"));Assert.Equal("1",_vm.Legs[1].PremiumText);
        Assert.False(_vm.AddWorkbenchContract("crossed",PositionSide.Long,1,"ask"));Assert.False(_vm.AddWorkbenchContract("call100",PositionSide.Long,1,"bid"));
        Assert.True(_vm.ToggleWorkbenchContract("call100",PositionSide.Long,1,"ask"));Assert.Single(_vm.Legs);Assert.True(_vm.ToggleWorkbenchContract("call100",PositionSide.Long,1,"ask"));Assert.Equal(2,_vm.Legs.Count);
    }
    [Fact] public void New_profiles_default_to_compact_columns_and_keep_explicit_detailed_choice()
    {
        var store=new SettingsStore(_directory);Assert.True(store.Load().Options.CompactColumns);
        store.Update(settings=>settings.Options.CompactColumns=false);
        Assert.False(new SettingsStore(_directory).Load().Options.CompactColumns);
    }
    [Fact] public void Corrupt_app_navigation_fails_closed_without_affecting_other_pages()
    {
        var path=Path.Combine(_directory,"apps","registry.json");Directory.CreateDirectory(Path.GetDirectoryName(path)!);File.WriteAllText(path,"{");
        Assert.False(ModuleNavigation.IsAvailable(_directory,AppPage.Options));Assert.False(ModuleNavigation.IsAvailable(_directory,AppPage.Strategy));Assert.True(ModuleNavigation.IsAvailable(_directory,AppPage.News));Assert.Equal("{",File.ReadAllText(path));
    }
    [Fact]
    public async Task Display_fields_share_analytics_and_preserve_missing_quotes_without_filling_missing_observations()
    {
        await _vm.LoadAsync();
        using var json = JsonDocument.Parse(StrategyWorkbench.Serialize(_vm, _palette));
        var call = json.RootElement.GetProperty("contracts").EnumerateArray().Single(c => c.GetProperty("id").GetString() == "call100");
        Assert.Equal(104, call.GetProperty("be").GetDouble()); // Ask 4, not midpoint 3.
        Assert.Equal(.04, call.GetProperty("bePercent").GetDouble(), 9);
        var expected = OptionEnricher.Enrich(ARight.Call, 100, 100, _expiry, .25, 2, 4, null,
            settings: new OptionEnrichmentSettings { RiskFreeRate = 0, DividendYield = 0, Now = _data.Chain!.AsOf!.Value });
        Assert.Equal(expected.Gamma!.Value, call.GetProperty("gamma").GetDouble(), 12);
        Assert.True(call.GetProperty("greeksComputedLocally").GetBoolean());
        Assert.Equal(JsonValueKind.Null, call.GetProperty("oi").ValueKind);
        var missing = json.RootElement.GetProperty("contracts").EnumerateArray().Single(c => c.GetProperty("id").GetString() == "missing");
        Assert.Equal(JsonValueKind.Null, missing.GetProperty("be").ValueKind);
        var crossed = json.RootElement.GetProperty("contracts").EnumerateArray().Single(c => c.GetProperty("id").GetString() == "crossed");
        Assert.Equal(JsonValueKind.Null, crossed.GetProperty("be").ValueKind);
    }
    [Fact]
    public async Task Column_preferences_persist_even_after_quote_revision_and_do_not_mutate_entries()
    {
        await _vm.LoadAsync(); Assert.True(_vm.AddWorkbenchContract("call100", PositionSide.Long, 1, "ask"));
        var premium = _vm.Legs[0].PremiumText; var key = _vm.WorkbenchKey;
        using var preference = JsonDocument.Parse("""{"kind":"set-columns","key":"old-quote-revision","columns":["Gamma","Be"]}""");
        Assert.True(StrategyWorkbench.ValidEvent(preference.RootElement)); StrategyWorkbench.Dispatch(_vm, preference.RootElement);
        Assert.Equal(new[] { "Be", "Gamma" }, new SettingsStore(_directory).Load().Options.WorkbenchColumns);
        Assert.Equal(key, _vm.WorkbenchKey); Assert.Equal(premium, _vm.Legs[0].PremiumText);
        Assert.False(_vm.SetWorkbenchColumns(["unknown"])); Assert.False(_vm.SetWorkbenchColumns(["Gamma", "Gamma"]));
        using var bad = JsonDocument.Parse("""{"kind":"set-columns","key":"x","columns":["Gamma",1]}""");
        Assert.False(StrategyWorkbench.ValidEvent(bad.RootElement));
        Assert.True(_vm.SetWorkbenchColumns([])); Assert.Empty(new SettingsStore(_directory).Load().Options.WorkbenchColumns);
        using var json = JsonDocument.Parse(StrategyWorkbench.Serialize(_vm, _palette)); Assert.Empty(json.RootElement.GetProperty("columns").EnumerateArray());
    }
    [Fact]
    public async Task Failed_preference_save_retains_disk_choice_and_draft_and_reports_conflict()
    {
        await _vm.LoadAsync(); _vm.AddWorkbenchContract("call100", PositionSide.Long, 1, "ask");
        Assert.True(_vm.SetWorkbenchColumns(["Iv"]));
        var other = new SettingsStore(_directory); other.Load(); other.Update(s => s.Options.WorkbenchColumns = ["Oi"]);
        Assert.False(_vm.SetWorkbenchColumns(["Gamma"]));
        Assert.Equal(new[] { "Oi" }, new SettingsStore(_directory).Load().Options.WorkbenchColumns);
        Assert.Equal(new[] { "Oi" }, _vm.WorkbenchVisibleColumns); Assert.NotEmpty(_vm.WorkbenchMessage);
        Assert.Equal("4", Assert.Single(_vm.Legs).PremiumText);
        Assert.True(_vm.SetWorkbenchColumns(["Gamma"])); Assert.Equal(new[] { "Gamma" }, new SettingsStore(_directory).Load().Options.WorkbenchColumns); Assert.Empty(_vm.WorkbenchColumnsError);
        Assert.False(_vm.SelectWorkbenchExpiration(_expiry.AddYears(1))); Assert.Equal(_expiry, _vm.SelectedExpiration!.Date);
    }
    [Fact]
    public async Task Private_expiry_control_reuses_listed_dates_and_rejects_invalid_or_stale_requests()
    {
        await _vm.LoadAsync(); using var session = new WebChartSession(_vm); session.Update(_palette);
        using var client = new HttpClient(new HttpClientHandler { UseProxy = false });
        async Task<HttpStatusCode> Send(string date, string key)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(session.PageUri, "event")) { Content = new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(new { kind = "select-expiration", key, expiration = date })) };
            request.Headers.Add("Origin", session.Origin); request.Content.Headers.ContentType = new("application/json"); using var response = await client.SendAsync(request); return response.StatusCode;
        }
        Assert.Equal(HttpStatusCode.NoContent, await Send(_expiry.ToString("yyyy-MM-dd"), _vm.WorkbenchKey));
        Assert.Equal(HttpStatusCode.BadRequest, await Send("2099-99-99", _vm.WorkbenchKey));
        Assert.Equal(HttpStatusCode.NoContent, await Send(_expiry.AddDays(1).ToString("yyyy-MM-dd"), _vm.WorkbenchKey));
        Assert.Equal(_expiry, _vm.SelectedExpiration!.Date); Assert.NotEmpty(_vm.WorkbenchMessage);
        Assert.Equal(HttpStatusCode.NoContent, await Send(_expiry.ToString("yyyy-MM-dd"), "stale"));
        Assert.Equal(_expiry, _vm.SelectedExpiration.Date); Assert.Empty(_vm.Legs);
    }
    public void Dispose(){_vm.Deactivate();if(Directory.Exists(_directory))Directory.Delete(_directory,true);}
}
