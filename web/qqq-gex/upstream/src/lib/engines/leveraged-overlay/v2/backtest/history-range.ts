/** Preserve the historical warm-up horizon used by the public daily API. */
export function dailyHistoryRangeForStart(startDate?: string, historyAnchorStart?: string): string {
  const requestedStart = new Date(`${startDate ?? ''}T00:00:00Z`);
  const anchoredStart = new Date(`${historyAnchorStart ?? ''}T00:00:00Z`);
  const start = !Number.isNaN(anchoredStart.getTime()) && (Number.isNaN(requestedStart.getTime()) || anchoredStart < requestedStart)
    ? anchoredStart
    : requestedStart;
  if (Number.isNaN(start.getTime())) return '5y';
  const days = Math.ceil((Date.now() - start.getTime()) / 86400000) + 300;
  return `${Math.max(days, 365)}d`;
}

export function dailyHistoryRangeForSamples(sampleCount: number, warmupBars: number, historyAnchorStart?: string): string {
  const bars = sampleCount + warmupBars;
  const sampleDays = Math.ceil(bars * 365.25 / 252) + 365;
  const anchored = dailyHistoryRangeForStart(undefined, historyAnchorStart);
  const anchorDays = anchored.endsWith('d') ? Number(anchored.slice(0, -1)) : 5 * 365;
  return `${Math.max(sampleDays, anchorDays)}d`;
}
