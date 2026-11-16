using CommunityToolkit.Mvvm.ComponentModel;
using Meili.Core.Models;
using Meili.Core.Quotes;
using Meili.Core.Settings;
namespace Meili.Shared.Services;

/// <summary>Reusable current-price presentation. Keeps pricing/history snapshots separate and unsubscribes when the page hides.</summary>
public sealed partial class LiveQuotePresenter(QuoteHub? hub,LocalizationService loc,string owner) : ObservableObject
{
    private bool _active;
    private Quote? _original;
    public string Symbol {get;private set;}="";
    public Quote? Quote {get;private set;}
    [ObservableProperty] public partial string Text {get;set;}="";
    [ObservableProperty] public partial string Tooltip {get;set;}="";
    public event EventHandler? Updated;
    public void Activate(string symbol)
    {
        if(!WatchlistStore.TryNormalizeSymbol(symbol,out var normalized,out _)){Deactivate();return;}
        if(!_active){_active=true;if(hub is not null)hub.Updated+=OnBatch;loc.LanguageChanged+=OnLanguage;}
        if(Symbol!=normalized){Symbol=normalized;Quote=null;_original=null;Text="";Tooltip="";}
        hub?.Subscribe(owner,[Symbol]);if(hub is not null&&hub.TryGetCached(Symbol,out var quote))Apply(quote);
    }
    public void Deactivate()
    {
        _active=false;if(hub is not null)hub.Updated-=OnBatch;hub?.Unsubscribe(owner);loc.LanguageChanged-=OnLanguage;
        Quote=null;_original=null;Text="";Tooltip="";
    }
    private void OnBatch(object? sender,QuoteBatch batch){if(_active&&batch.Find(Symbol) is { } quote)Apply(quote);}
    private void OnLanguage(object? sender,EventArgs e){if(_original is { } quote)Apply(quote);}
    private void Apply(Quote quote)
    {
        _original=quote;var now=DateTimeOffset.UtcNow;var view=QuotePriceView.Select(quote,now);Quote=view.Snapshot;
        Text=Symbol+" · "+loc["Quote_Current"]+" "+NumberDisplay.Price(Quote.Price)+" · "+(view.IsExtended?loc[view.SessionKey]+" · ":"")+FreshnessText.SourceAndTiming(Quote,loc,now);
        Tooltip=FreshnessText.Tooltip(quote,loc,now)+"\n"+view.Reference(quote,loc);
        Updated?.Invoke(this,EventArgs.Empty);
    }
}
