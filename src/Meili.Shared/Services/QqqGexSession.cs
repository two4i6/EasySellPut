using System.Text.Json;
using Meili.Automation.Apps.QqqGex;
using Meili.Automation.Modules;
using Meili.Core.Quotes;
using Meili.Core.Models;
namespace Meili.Shared.Services;

/// <summary>Native presentation adapter over the same headless GEX document host used by AppDev.</summary>
public sealed class QqqGexSession : IPrivateAppSession,IAsyncDisposable
{
    private readonly QqqGexAppSession inner;
    public QqqGexSession(string? databasePath=null,string snapshot="local",QuoteHub? quotes=null,DesktopActivity? activity=null,PrivateAppOperations? appOperations=null)
    {
        inner=new(databasePath,snapshot,quotes,activity,appOperations,route=>typeof(QqqGexSession).Assembly.GetManifestResourceStream("QqqGex/"+route),ProjectQuote);
    }
    private static object ProjectQuote(Quote original)
    {
        var view=QuotePriceView.Select(original,DateTimeOffset.UtcNow);var quote=view.Snapshot;
        return new{quote.Symbol,quote.Price,quote.Change,quote.ChangePercent,quote.Source,quote.Delivery,quote.StreamState,quote.StreamStateAt,quote.AsOf,quote.FetchedAt,quote.DelayMinutes,quote.IsRealtime,session=view.Session.ToString(),regularReferencePrice=original.Price,regularAsOf=original.AsOf};
    }
    public Uri PageUri=>inner.PageUri;
    public bool IsPageUrl(string url)=>inner.IsPageUrl(url);
    public void UpdatePresentation(ChartPalette palette)=>inner.UpdatePresentation(AppViewPresentation.Create(palette));
    public void UpdateCaptureState(QqqGexCaptureState value)=>inner.UpdateCaptureState(value);
    public void NotifyDataUpdated()=>inner.NotifyDataUpdated();
    internal static byte[] SerializeQuery(JsonElement value)=>QqqGexAppSession.SerializeQuery(value);
    public void Dispose()=>inner.Dispose();
    public ValueTask DisposeAsync()=>inner.DisposeAsync();
}
