import { qqqGexObservation, qqqImmutableGexObservation, type GexObservationSnapshot } from './qqqGexObservationComparison';
import { createQqqSharedPreparation, awaitQqqPreparation } from './qqqSharedPreparation';
import { qqqGexSessionDte } from './qqqGexSelection';
import type { PcsGexExpiry, QqqPcsApiResponse } from '@/types/qqqGex';
import { exposureReplayDisplayPayload, exposureReplayExpiries, exposureReplayTableRows, type QqqExposureReplayContext } from './qqqExposureReplay';
import { immutableExposureFrame, type ExposureFrame } from './qqqExposureWorkbench';
import { qqqTopNetGexProfile } from './qqqGexSummary';

/** Latest price candles can outlive option collection; historical cursors remain causal.
 * Only the chart's price tracks advance. Saved exposure/model timestamps stay intact.
 */
export function exposureChartLatestPrices(base: QqqPcsApiResponse, replay: QqqExposureReplayContext, projected: QqqPcsApiResponse): QqqPcsApiResponse {
  if (!replay.followingLatest || !base.intraday || !projected.intraday) return projected;
  const lastPrice = base.intraday.bars.at(-1)?.timestamp;
  const priceTime = lastPrice ? Date.parse(lastPrice) : NaN;
  const priceDate = base.view.date ?? (Number.isFinite(priceTime) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(priceTime) : null);
  if (priceDate !== replay.date) return projected;
  // The small live window can contain only after-hours bars. Retain the
  // archive's regular-session candles, with latest rows winning corrections.
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const byTime = new Map(base.intraday.bars.map(bar => [bar.timestamp,bar]));
  let added=false;
  for(const bar of replay.bars){const at=Date.parse(bar.timestamp);if(Number.isFinite(at)&&sameDay.format(at)===replay.date&&!byTime.has(bar.timestamp)){byTime.set(bar.timestamp,bar);added=true;}}
  const prices=added?[...byTime.values()].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)):base.intraday.bars;
  return { ...projected, intraday: { ...projected.intraday,
    bars: prices,
    extendedHoursBars: base.intraday.extendedHoursBars,
  } };
}

/** Keep matrix columns discoverable without filling excluded DTEs with latest data. */
export function exposureReplayMatrixExpiries(source: readonly PcsGexExpiry[], projected: readonly PcsGexExpiry[],date?:string|null) {
  const available = new Map(projected.map(expiry => [expiry.expiryDate, expiry]));
  const empty = (expiry: PcsGexExpiry): PcsGexExpiry => ({ ...expiry, dte:qqqGexSessionDte(expiry.expiryDate,date,expiry.dte), asOf: '', gex: [], gexProfile: [], gexProfileHistory: [], fullGexProfile: [], fullGexProfileHistory: [], gexSummary: null, wallHistory: [], terminal: undefined, research: null });
  return [...source.map(expiry => available.get(expiry.expiryDate) ?? empty(expiry)), ...projected.filter(expiry => !source.some(e => e.expiryDate === expiry.expiryDate))];
}

/** Immutable archive projection is built once; cursor changes only slice tracks.
 * No model curves or trade qualifications are recomputed for past observations.
 */
const tracks = new WeakMap<readonly ExposureFrame[], Map<string, PcsGexExpiry>>();
const tableTracks = new WeakMap<readonly ExposureFrame[], WeakMap<QqqExposureReplayContext['bars'], ReturnType<typeof exposureReplayTableRows>>>();
function aggregateRows(frames: readonly ExposureFrame[], bars: QqqExposureReplayContext['bars']) {
  let byBars = tableTracks.get(frames);
  if (!byBars) { byBars = new WeakMap(); tableTracks.set(frames, byBars); }
  let rows = byBars.get(bars);
  if (!rows) { rows = exposureReplayTableRows(frames, bars); byBars.set(bars, rows); }
  return rows;
}
function appendReplayFrame(result: Map<string,PcsGexExpiry>,frame: ExposureFrame) {
  for (const expiry of exposureReplayExpiries(frame)) {
    let track = result.get(expiry.expiryDate);
    if (!track) { track = { ...expiry, gex: [], gexProfileHistory: [], fullGexProfileHistory: [], wallHistory: [] }; result.set(expiry.expiryDate, track); }
    const last = track.fullGexProfileHistory.at(-1);
    if (last?.time === expiry.asOf) continue;
    track.fullGexProfileHistory.push({ time: expiry.asOf, strikes: expiry.fullGexProfile });
    track.gexProfileHistory.push({ time: expiry.asOf, strikes: qqqTopNetGexProfile(expiry.fullGexProfile, p => p.totalGex) });
    const summary = expiry.gexSummary;
    const observation:GexObservationSnapshot={time:expiry.asOf,netGex:summary?.netGex??NaN,inputComplete:Boolean(summary),profile:expiry.fullGexProfile};
    const observed=immutableExposureFrame(frame)?qqqImmutableGexObservation(observation):qqqGexObservation(observation);
    if(observed&&Number.isFinite(observed.net)){
      const point={time:expiry.asOf,totalGex:observed.net,gammaFlipLevel:observed.partial?null:summary?.gammaFlip??null,observation};
      track.gex.push(point);
    }
    track.wallHistory.push({ time: expiry.asOf, callWallPrice: summary?.callWall?.strike ?? null, putWallPrice: summary?.putWall?.strike ?? null, callWallMagnitude: summary?.callWall?.magnitude ?? null, putWallMagnitude: summary?.putWall?.magnitude ?? null, kingStrike: summary?.king?.strike ?? null, kingMagnitude: summary?.king?.magnitude ?? null, kingSide: summary?.king?.side ?? null });
  }
}
function replayTracks(frames: readonly ExposureFrame[]) {
  const known=tracks.get(frames);if(known)return known;
  const result=new Map<string,PcsGexExpiry>();
  for(const frame of frames)appendReplayFrame(result,frame);
  tracks.set(frames,result);return result;
}

export function preparedExposureReplayRows(frames: readonly ExposureFrame[],bars: QqqExposureReplayContext['bars']) {
  return tableTracks.get(frames)?.get(bars);
}
export function exposureChartReplayReady(frames: readonly ExposureFrame[],bars: QqqExposureReplayContext['bars']) {
  return tracks.has(frames)&&Boolean(preparedExposureReplayRows(frames,bars));
}

/** Prepare cold archives outside render, yielding between small CPU batches.
 * Cancellation never publishes a partial index; immutable references invalidate caches.
 */
async function prepareExposureChartReplayArchive(frames: readonly ExposureFrame[],bars: QqqExposureReplayContext['bars'],signal?: AbortSignal,yieldControl=()=>new Promise<void>(resolve=>setTimeout(resolve,0)), chart=true) {
  const check=()=>{if(signal?.aborted)throw new DOMException('Replay preparation cancelled','AbortError');};
  check();if(chart?exposureChartReplayReady(frames,bars):Boolean(preparedExposureReplayRows(frames,bars)))return;
  const existing=tracks.get(frames),result=existing??new Map<string,PcsGexExpiry>();
  const oldRows=preparedExposureReplayRows(frames,bars),rows:ReturnType<typeof exposureReplayTableRows>=[];
  let sliceStart=performance.now();
  for(const frame of frames) {
    check();if(chart&&!existing)appendReplayFrame(result,frame);
    if(!oldRows)rows.push(...exposureReplayTableRows([frame],bars));
    if(performance.now()-sliceStart>=6){await yieldControl();check();sliceStart=performance.now();}
  }
  check();if(chart)tracks.set(frames,result);
  if(!oldRows){let byBars=tableTracks.get(frames);if(!byBars){byBars=new WeakMap();tableTracks.set(frames,byBars);}byBars.set(bars,rows);}
}

type ReplayPreparationInput = { frames: readonly ExposureFrame[]; bars: QqqExposureReplayContext['bars']; yieldControl?: () => Promise<void>; chart?: boolean };
export const acquireExposureChartReplay = createQqqSharedPreparation<ReplayPreparationInput, void>(
  input => input.chart === false ? 'rows' : 'chart', (input, signal) => prepareExposureChartReplayArchive(input.frames, input.bars, signal, input.yieldControl, input.chart),
);

export async function prepareExposureChartReplay(frames: readonly ExposureFrame[], bars: QqqExposureReplayContext['bars'], signal?: AbortSignal, yieldControl?: () => Promise<void>) {
  signal?.throwIfAborted();
  return awaitQqqPreparation(acquireExposureChartReplay({ frames, bars, yieldControl }), signal);
}

export function exposureReplayChartPayload(base: QqqPcsApiResponse, replay: QqqExposureReplayContext): QqqPcsApiResponse {
  const display = exposureReplayDisplayPayload(base, replay);
  if (!display.intraday || !replay.frame) return display;
  const time = replay.frame.time;
  const prefix = <T extends { time: string }>(points: readonly T[]) => {
    let lo = 0, hi = points.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (Date.parse(points[mid]!.time) <= time) lo = mid + 1; else hi = mid; }
    return points.slice(0, lo);
  };
  const history = replayTracks(replay.frames ?? [replay.frame]);
  const expiries = display.intraday.gexExpiries!.map(expiry => {
    const track = history.get(expiry.expiryDate);
    if (!track || !expiry.fullGexProfile.length) return expiry;
    const profiles = prefix(track.gexProfileHistory);
    return { ...expiry, gex: prefix(track.gex), gexProfile: profiles.at(-1)?.strikes ?? [], gexProfileHistory: profiles, fullGexProfileHistory: prefix(track.fullGexProfileHistory), wallHistory: prefix(track.wallHistory) };
  });
  // Aggregate net exposure only when stored versions, units and coverage agree.
  // Aggregate walls/flip have no equivalent saved definition and stay empty.
  const selected = expiries.find(e => e.expiryDate === (replay.scope === '0dte' ? replay.date : replay.selectedExpiry));
  const aggregate = replay.scope === 'all';
  const rows = aggregate ? aggregateRows(replay.frames ?? [replay.frame], replay.bars).filter(f => f.time <= time) : [];
  return { ...display, intraday: { ...display.intraday, gexExpiries: expiries,
    gex: aggregate ? rows.flatMap(row => row.displayNet === null ? [] : [{ time: new Date(row.time).toISOString(), totalGex: row.displayNet, gammaFlipLevel: null, observation: row.observation }]) : selected?.gex ?? [],
    gexProfile: aggregate ? [] : selected?.gexProfile ?? [], gexProfileHistory: aggregate ? [] : selected?.gexProfileHistory ?? [],
    gexSummary: aggregate ? null : selected?.gexSummary ?? null, wallHistory: aggregate ? [] : selected?.wallHistory ?? [],
    gammaPositionHistory: (base.intraday?.gammaPositionHistory ?? []).filter(p => Date.parse(p.time) <= time && (aggregate || p.expiryDate === selected?.expiryDate)),
  } };
}
