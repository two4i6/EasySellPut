export type QqqLiveCandle = { time: number; open: number; high: number; low: number; close: number };
/** Merge a confirmed snapshot with the current quote candle without rewinding its close. */
export function retainQqqLiveCandle(snapshot: readonly (Omit<QqqLiveCandle, 'time'> & { time: unknown })[], live: QqqLiveCandle | null): readonly (Omit<QqqLiveCandle, 'time'> & { time: unknown })[] {
  const last = snapshot.at(-1);
  if (!live || !last || live.time < Number(last.time)) return snapshot;
  if (live.time > Number(last.time)) return [...snapshot, live];
  return [...snapshot.slice(0, -1), { ...last, high: Math.max(last.high, live.high), low: Math.min(last.low, live.low), close: live.close }];
}

export function retainQqqLiveHistory(snapshot: readonly (Omit<QqqLiveCandle, 'time'> & { time: unknown })[], live: Iterable<QqqLiveCandle>) {
 const last = snapshot.at(-1);
 if (!last) return snapshot;
 let result = snapshot;
 for (const candle of [...live].filter(candle=>candle.time >= Number(last.time)).sort((a,b)=>a.time-b.time)) result = retainQqqLiveCandle(result,candle);
 return result;
}

/** Anchor to the actual price tail, not future session placeholders in other series. */
export function qqqLatestLogicalRange(index: number, range: {from:number;to:number}|null) {
 const span = range ? Math.max(10,range.to-range.from) : 60;
 const padding = Math.min(6,span*.12);
 return {from:index+padding-span,to:index+padding};
}
