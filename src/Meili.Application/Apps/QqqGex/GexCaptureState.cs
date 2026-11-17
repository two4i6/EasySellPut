namespace Meili.Shared.Services;

/// <summary>Transport-neutral capture/publication status shared with native hosts.</summary>
public sealed record QqqGexCaptureState(string Phase,DateTimeOffset? StartedAt=null,DateTimeOffset? UpdatedAt=null,DateTimeOffset? SourceMarketAt=null,int? DelayMinutes=null,int? MissingIv=null,int? CapturedExpiries=null,bool? InputComplete=null);
