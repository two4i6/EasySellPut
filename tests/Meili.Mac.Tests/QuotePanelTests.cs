using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Meili.Core.Models;
using Meili.Core.Quotes;
using Meili.Core.Settings;
using Meili.Core.Time;
using Meili.Mac.Platform;
using Meili.App.Tests;
namespace Meili.Mac.Tests;
public sealed class QuotePanelTests
{
    [AvaloniaTheory]
    [InlineData("zh-CN",false)] [InlineData("en-US",true)] [InlineData("zh-CN",true)] [InlineData("en-US",false)]
    public async Task Real_panel_renders_all_symbols_changes_intraday_and_keeps_hidden_work_stopped(string language,bool dark)
    {
        MacHost.EnsureComposed();var loc=LocalizationService.Current;loc.Apply(language);var theme=AppServices.Get<MacTheme>();theme.Apply(dark?AppThemeMode.Dark:AppThemeMode.Light);
        var data=new PanelFixture();var hub=new QuoteHub(data);var context=new SymbolContext();context.Set("AAPL");var store=new SettingsStore(Path.Combine(MacHost.DataDir,"panel"));var watch=new WatchlistStore(store);var model=new QuotePanelViewModel(hub,data,watch,context,loc);var opened="";var w=new QuotePanelWindow(model,s=>opened=s,()=>{},()=>{});
        try
        {
            await w.ShowPanelAsync();await Task.Delay(220);MacHost.Pump();Assert.Equal(6,model.Rows.Count);Assert.All(model.Rows,r=>Assert.True(r.Graph.Points.Count>10));Assert.Equal(6,hub.SubscribedSymbols.Count);
            MacHost.Save(w,$"quote-panel-{language}-{dark}");model.Select("NVDA");MacHost.Pump();Assert.Equal("NVDA",model.Selected!.Symbol);Assert.NotEqual(model.Rows[0].Graph.Points[10].Y,model.Rows[^1].Graph.Points[10].Y);
            w.HidePanel();Assert.Empty(hub.SubscribedSymbols);var count=data.Bars;await hub.PollAsync();Assert.Equal(count,data.Bars);
            await w.ShowPanelAsync();Assert.Equal(count,data.Bars);w.HidePanel();
        }
        finally{w.Close();loc.Apply("zh-CN");theme.Apply(AppThemeMode.System);}
    }
    [AvaloniaFact] public async Task Chart_work_is_bounded_cancels_on_hide_and_paging_only_subscribes_visible_symbols()
    {
        MacHost.EnsureComposed();var data=new PanelFixture{Block=true};var hub=new QuoteHub(data);var context=new SymbolContext();context.Set("AAPL");var settings=new SettingsStore(Path.Combine(MacHost.DataDir,"panel-bounds"));var watch=new WatchlistStore(settings);
        using var model=new QuotePanelViewModel(hub,data,watch,context,LocalizationService.Current);
        var loading=model.ActivateAsync();await Task.Delay(50);MacHost.Pump();Assert.InRange(data.MaxFlight,1,2);model.Deactivate();await loading;Assert.Empty(hub.SubscribedSymbols);Assert.Equal(0,data.InFlight);Assert.False(model.IsBusy);
        data.Block=false;await model.ActivateAsync();Assert.All(model.Rows,r=>Assert.NotEmpty(r.Graph.Points));
        foreach(var symbol in new[]{"TESTA","TESTB","TESTC"})watch.AddSymbol(watch.Groups[0].Id,symbol,out _);
        await model.MoveAsync(1);Assert.Equal(2,model.Pages);Assert.Single(model.Rows);Assert.Single(hub.SubscribedSymbols);
    }
    private sealed class PanelFixture : Meili.Core.Abstractions.IMarketDataService
    {
        private readonly FakeMarketDataService _other=new();public int Bars;public bool Block;public int InFlight,MaxFlight;
        private static double Price(string s)=>s switch{"AAPL"=>356.27,"SPY"=>754.37,"QQQ"=>612.45,"MSFT"=>507.32,"NVDA"=>162.85,_=>421.06};
        private static double Delta(string s)=>s is "QQQ" or "NVDA"?-.67:.39;
        private static DateTime Date(){var now=MarketClock.ToEastern(DateTimeOffset.UtcNow);var day=now.Date;if(now.TimeOfDay<TimeSpan.FromHours(16))day=day.AddDays(-1);while(day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)day=day.AddDays(-1);return day;}
        public Task<IReadOnlyList<Quote>> GetQuotesAsync(IReadOnlyList<string> symbols,CancellationToken ct=default)=>Task.FromResult<IReadOnlyList<Quote>>(symbols.Select(s=>FakeMarketDataService.MakeQuote(s,Price(s)) with{Name=s switch{"AAPL"=>"Apple Inc.","NVDA"=>"NVIDIA Corp.","MSFT"=>"Microsoft Corp.","SPY"=>"SPDR S&P 500 ETF",_=>s},ChangePercent=Delta(s),PreviousClose=Price(s)/(1+Delta(s)/100),Open=Price(s)*.997,High=Price(s)*1.008,Low=Price(s)*.985,Volume=35120000,MarketState=MarketState.Closed,AsOf=MarketClock.FromEastern(Date().AddHours(16)),DelayMinutes=15,IsRealtime=false}).ToArray());
        public async Task<BarSeries> GetBarsAsync(BarRequest request,CancellationToken ct=default){Bars++;if(Block){InFlight++;MaxFlight=Math.Max(MaxFlight,InFlight);try{await Task.Delay(Timeout.Infinite,ct);}finally{InFlight--;}}var start=MarketClock.FromEastern(Date().AddHours(9.5));var seed=request.Symbol.Sum(c=>(int)c);var price=Price(request.Symbol);return new BarSeries{Symbol=request.Symbol,Interval=request.Interval,Source="yahoo",DelayMinutes=15,AsOf=start.AddHours(6.5),FetchedAt=DateTimeOffset.UtcNow,Bars=Enumerable.Range(0,78).Select(i=>Bar.CloseOnly(start.AddMinutes(i*5),price*(1+.003*Math.Sin(i*.19+seed)+Delta(request.Symbol)*.0001*i),1000)).ToArray()};}
        public Task<IReadOnlyList<DateOnly>> GetExpirationsAsync(string s,CancellationToken ct=default)=>_other.GetExpirationsAsync(s,ct);
        public Task<OptionChain> GetChainAsync(string s,DateOnly? d=null,CancellationToken ct=default)=>_other.GetChainAsync(s,d,ct);
        public Task<Fundamentals> GetFundamentalsAsync(string s,CancellationToken ct=default)=>_other.GetFundamentalsAsync(s,ct);
        public Task<FinancialStatements> GetFinancialsAsync(string s,CancellationToken ct=default)=>_other.GetFinancialsAsync(s,ct);
        public Task<IReadOnlyList<NewsItem>> GetNewsAsync(string s,int count=20,CancellationToken ct=default)=>_other.GetNewsAsync(s,count,ct);
        public Task<IReadOnlyList<SymbolMatch>> SearchAsync(string s,int limit=10,CancellationToken ct=default)=>_other.SearchAsync(s,limit,ct);
    }
}
