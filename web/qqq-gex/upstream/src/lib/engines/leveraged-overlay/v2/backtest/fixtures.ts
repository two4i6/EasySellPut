import { readFile } from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import { join } from 'node:path';
import type { OHLCV } from '../../types/input';
import type { SplitEvent } from '../../types/input';
import type { FinancialFactor } from '../../../../../types/factor';
import { createRawFactor } from '../../../../factor';
import type { RegisteredFixtureId } from './run-spec';
import type { SlowSubregimeDiagnostic } from '../../backtest/types';

type FixtureSnapshot = {
  createdAt: string;
  source: string;
  symbols: Record<string, OHLCV[]>;
  splitEvents?: Record<string, SplitEvent[]>;
};

export type MarketDataSet = {
  loadWarnings?: string[];
  dataLoadCoverage?: { vixFallbackCount: number; vix3mYahooRefreshCount: number; vix3mCboeSameDayCount: number; vix3mFredSameDayCount: number };
  snapshotMetadata?: { createdAt: string; source: string };
  qqqBars: OHLCV[];
  tqqqBars: OHLCV[];
  boxxBars: OHLCV[];
  vixByDate: Record<string, number>;
  vix3mByDate: Record<string, number>;
  vxnByDate: Record<string, number>;
  /** Frozen S&P 500 index bars for Unified-regime parity research. */
  spxBars?: OHLCV[];
  spyBars?: OHLCV[];
  barsBySymbol?: Record<string, OHLCV[]>;
  splitEventsBySymbol?: Record<string, FinancialFactor<SplitEvent[]>>;
  slowSubregimeByDate?: Record<string, SlowSubregimeDiagnostic>;
  fingerprint: string;
};

const fixtureFiles: Partial<Record<RegisteredFixtureId, string>> = {
  'market-2026-07-03': 'market-2026-07-03.json',
  'market-2026-07-03-vxn': 'market-2026-07-03-vxn.json',
  'market-2026-07-21-vxn': 'market-2026-07-21-vxn.json',
  'market-2026-07-31-vxn': 'market-2026-07-31-vxn.json',
  'market-2026-09-09-vxn': 'market-2026-09-09-vxn.json',
};

const toMap = (bars: OHLCV[] = []) => Object.fromEntries(bars.map(({ date, close }) => [date, close]));

export function fixtureStoragePath(fixtureId:string){
  if(fixtureId==='market-2026-10-23-15y-vxn'||fixtureId==='market-2026-10-29-15y-vxn')return join(process.cwd(),'data/replay-snapshots',fixtureId+'.json.gz');
  const filename=Object.prototype.hasOwnProperty.call(fixtureFiles,fixtureId)?fixtureFiles[fixtureId as RegisteredFixtureId]:undefined;
  if(!filename)throw Error(`Unknown fixture: ${fixtureId}`);
  return join(process.cwd(),'docs/overlay-tuning/fixtures',filename);
}
/** Hash the original uncompressed bytes; worker and CLI bind identical input. */
export async function readFixtureBytes(fixtureId:string){
  const stored=await readFile(fixtureStoragePath(fixtureId));
  if(fixtureId!=='market-2026-10-23-15y-vxn'&&fixtureId!=='market-2026-10-29-15y-vxn')return stored;
  const raw=gunzipSync(stored);
  if(createHash('sha256').update(raw).digest('hex')!==(fixtureId==='market-2026-10-29-15y-vxn'?'2498755cc807a77238b0cf4875b5832bd726af8330c39b7d752d681a0741084d':'2c4ea654b9ce3934fd96efeacb775a828366f5501344024f7b52f194ceb155eb'))throw Error('Current15-year market snapshot checksum mismatch');
  return raw;
}
export async function loadFixture(fixtureId: string): Promise<MarketDataSet> {
  if(fixtureId==='market-2026-10-23-15y-vxn'||fixtureId==='market-2026-10-29-15y-vxn')return JSON.parse((await readFixtureBytes(fixtureId)).toString()) as MarketDataSet;
  const fixtureFile = Object.prototype.hasOwnProperty.call(fixtureFiles, fixtureId)
    ? fixtureFiles[fixtureId as RegisteredFixtureId]
    : undefined;
  if (!fixtureFile) throw new Error(`Unknown fixture: ${fixtureId}`);
  const path = join(process.cwd(), 'docs/overlay-tuning/fixtures', fixtureFile);
  const snapshot = JSON.parse(await readFile(path, 'utf8')) as FixtureSnapshot;
  const { QQQ: qqqBars, TQQQ: tqqqBars, BOXX: boxxBars, VIX: vix, VIX3M: vix3m, VXN: vxn, SPX: spxBars, SPY: spyBars } = snapshot.symbols;
  if (!qqqBars?.length || !tqqqBars?.length || !vix?.length) throw new Error(`无效 fixture: ${fixtureId}`);
  const splitEventsBySymbol = Object.fromEntries(Object.entries(snapshot.splitEvents ?? {}).map(([symbol, events]) => [symbol, createRawFactor(events, validSplitEvents, 'fixed-fixture', `${symbol} 拆股事件`)]));
  const splitFingerprint = Object.entries(snapshot.splitEvents ?? {}).flatMap(([symbol, events]) => events.map(event => `${symbol}:${event.date}:${event.ratio}`)).join(',');
  const fingerprint = [fixtureId, qqqBars.length, tqqqBars.length, qqqBars.at(-1)?.date, tqqqBars.at(-1)?.date, splitFingerprint].join(':');
  return { qqqBars, tqqqBars, boxxBars: boxxBars ?? [], spxBars, spyBars, barsBySymbol: snapshot.symbols, splitEventsBySymbol, vixByDate: toMap(vix), vix3mByDate: toMap(vix3m), vxnByDate: toMap(vxn), fingerprint, snapshotMetadata: { createdAt: snapshot.createdAt, source: snapshot.source } };
}

export function validSplitEvents(events: SplitEvent[]): boolean {
  return events.every(event => /^\d{4}-\d{2}-\d{2}$/.test(event.date) && Number.isFinite(event.numerator) && event.numerator > 0 && Number.isFinite(event.denominator) && event.denominator > 0 && event.ratio === event.numerator / event.denominator);
}
