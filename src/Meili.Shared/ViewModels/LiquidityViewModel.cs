using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Meili.Core.Models;
using Meili.Shared.Services;

namespace Meili.Shared.ViewModels;

public partial class LiquidityViewModel : ObservableObject
{
    private readonly MarketLiquidityService _service;
    private readonly LocalizationService _loc;
    private readonly NavigationHub _nav;
    private CancellationTokenSource? _request;
    private long _generation;
    private bool _active;
    private LiquidityReport? _report;
    public double? PressureValue=>_report?.PressureIndex.Score;
    public string PressureText=>PressureValue?.ToString("0.0",System.Globalization.CultureInfo.InvariantCulture)??"—";
    public string PressureBand=>_loc["Liq_Band_"+(_report?.PressureIndex.Band??"unavailable")];
    public string PressureDates=>_report?.PressureIndex is {Components.Count:>0} index
        ?_loc["Liq_Daily"]+" "+string.Join(" / ",index.Components.Take(2).Select(c=>c.Date.ToString("MM-dd")).Distinct())+" · "+_loc["Liq_Weekly"]+" "+index.Components[2].Date.ToString("MM-dd")
        :_loc["Liq_Unavailable"];
    public string PressureHelp=>_loc["Liq_PressureHelp"]+"\n"+(_report?.PressureIndex is { } index?index.Method+"\n"+string.Join("\n",index.Components.Select(c=>$"{c.Id}: {c.Input:0.####} {c.Unit} · {c.Date:yyyy-MM-dd} · {c.Weight:P0}"))+(index.UnavailableReason is { } reason?"\n"+reason:""):"");
    public ObservableCollection<LiquidityMetricCard> Metrics { get; }=[];
    public ObservableCollection<SectorLiquidityCard> Sectors { get; }=[];
    [ObservableProperty] public partial bool IsBusy {get;set;}
    [ObservableProperty] public partial string Status {get;set;}="";
    public LiquidityViewModel(MarketLiquidityService service,LocalizationService loc,NavigationHub nav)
    {
        _service=service;_loc=loc;_nav=nav;
        _loc.LanguageChanged+=(_,_)=>Rebuild();Ui.Platform.ColorsChanged+=(_,_)=>Rebuild();
    }
    public async Task ActivateAsync(){_active=true;if(_report is null||DateTimeOffset.UtcNow-_report.GeneratedAt>TimeSpan.FromMinutes(30))await RefreshAsync();}
    public void Deactivate(){_active=false;_generation++;_request?.Cancel();IsBusy=false;}
    [RelayCommand]
    private async Task RefreshAsync()
    {
        _request?.Cancel();var request=_request=new CancellationTokenSource();var generation=++_generation;IsBusy=true;
        try{var report=await _service.LoadAsync(request.Token);if(generation==_generation&&_active){_report=report;Rebuild();}}
        catch(OperationCanceledException)when(request.IsCancellationRequested){}
        catch(Exception ex){Meili.Core.Diagnostics.AppLog.Warn("liquidity","Report refresh failed",ex);if(generation==_generation)Status=_loc["Liq_Unavailable"];}
        finally{if(generation==_generation)IsBusy=false;request.Dispose();if(ReferenceEquals(_request,request))_request=null;}
    }
    [RelayCommand]private void OpenSector(string? symbol){if(!string.IsNullOrEmpty(symbol))_nav.Go(AppPage.Charts,symbol);}
    private void Rebuild()
    {
        foreach(var property in new[]{nameof(PressureValue),nameof(PressureText),nameof(PressureBand),nameof(PressureDates),nameof(PressureHelp)})OnPropertyChanged(property);
        if(_report is null)return;
        Metrics.Clear();foreach(var metric in _report.Metrics)Metrics.Add(new(metric,_loc));
        Sectors.Clear();foreach(var sector in _report.Sectors)Sectors.Add(new(sector,_loc));
        var good=_report.Metrics.Count(m=>m.Latest is not null);var sectors=_report.Sectors.Count(s=>s.RelativeDollarVolume is not null);
        Status=$"{good}/6 · {sectors}/11 · {_report.GeneratedAt.ToLocalTime():HH:mm}";
    }
}
public sealed class LiquidityMetricCard(LiquidityMetric metric,LocalizationService loc)
{
    public string Title=>loc["Liq_"+metric.Id];
    public string Value=>metric.Latest is { } p?p.Value.ToString(metric.Unit=="basis points"?"+0.0;-0.0;0.0":"N1",System.Globalization.CultureInfo.InvariantCulture):"—";
    public string Unit=>loc[metric.Unit=="basis points"?"Liq_Bps":"Liq_Billions"];
    public string Date=>metric.Latest is { } p?p.Date.ToString("yyyy-MM-dd")+" · "+loc[metric.Frequency=="weekly"?"Liq_Weekly":"Liq_Daily"]:loc["Liq_Unavailable"];
    public string Help=>loc["Liq_Help_"+metric.Id]+"\n"+string.Join("\n",metric.Inputs.Select(s=>$"{s.Id} · {s.Unit} · {s.SourceUrl} · {loc["Liq_Fetched"]} {s.FetchedAt?.ToLocalTime():yyyy-MM-dd HH:mm}"))+(metric.UnavailableReason is { } reason?"\n"+reason:"");
}
public sealed class SectorLiquidityCard(SectorLiquidity sector,LocalizationService loc)
{
    public string Symbol=>sector.Symbol;
    public string Title=>loc["Liq_Sector_"+sector.Sector];
    public string Value=>sector.RelativeDollarVolume is { } ratio?ratio.ToString("0.00",System.Globalization.CultureInfo.InvariantCulture)+"×":"—";
    public string Date=>(sector.Date?.ToString("MM-dd")??loc["Liq_Unavailable"])+(sector.Offline?" · "+loc["Mb_Stale"]:"");
    public object? HeatBrush=>Ui.Platform.Resource(sector.RelativeDollarVolume is not { } ratio?"ControlFillColorDefaultBrush":ratio<0.8?"LiquidityHeatLowBrush":ratio<1.2?"LiquidityHeatNormalBrush":"LiquidityHeatHighBrush");
    public string Help=>$"{Title} · {Symbol}\n"+loc["Liq_HeatHelp"]+"\n"+$"{loc["Liq_Turnover"]}: {(sector.DollarVolume/1_000_000)?.ToString("N1",System.Globalization.CultureInfo.InvariantCulture)??"—"} USDm\nAmihud: {sector.AmihudPercentPerMillion?.ToString("0.0000",System.Globalization.CultureInfo.InvariantCulture)??"—"} % / USDm\n{sector.Date:yyyy-MM-dd} · {sector.Source} · {sector.Adjustment}"+(sector.Offline?" · "+loc["Mb_Stale"]:"")+(sector.UnavailableReason is { } reason?"\n"+reason:"");
}
