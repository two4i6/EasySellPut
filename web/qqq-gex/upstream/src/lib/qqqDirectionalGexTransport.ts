import {decodeQqqChartProfile} from './qqqChartProfileTransport';
import type { CompactGexStrike } from './qqqGexHistory';

/** Historical directional consumers: validity, net/coverage comparisons,
 * quote coverage, and as-of timing. Display and pricing use separate profiles. */
export const QQQ_DIRECTIONAL_GEX_FIELDS = [
  'strike', 'callGex', 'putGex', 'totalGex', 'callOi', 'putOi',
  'callBid', 'callAsk', 'callMid', 'callIv', 'callDelta', 'callGamma',
  'putBid', 'putAsk', 'putMid', 'putIv', 'putDelta', 'putGamma',
  'calculationVersion', 'gexUnit', 'inputComplete', 'computedAt', 'sourceAsOf',
  'callReceivedAt', 'putReceivedAt',
] as const;

export type QqqDirectionalGexTransport = {
  version: 1;
  constants: Record<string, unknown>;
  columns: string[];
  rows: unknown[][];
};

/** Reference encoder for parity/byte measurements; SQL owns the wire encoding. */
export function encodeQqqDirectionalGexProfile(profile: readonly CompactGexStrike[]): QqqDirectionalGexTransport {
  const constants: Record<string, unknown> = {}, columns: string[] = [];
  for (const key of QQQ_DIRECTIONAL_GEX_FIELDS) {
    const first = profile[0]?.[key] ?? null;
    if (profile.every(point => (point[key] ?? null) === first)) {
      if (first !== null) constants[key] = first;
    } else columns.push(key);
  }
  return { version: 1, constants, columns, rows: profile.map(point => columns.map(key => (point as unknown as Record<string, unknown>)[key] ?? null)) };
}

/** Reconstruct exact values without rounding, sampling, or changing absence
 * semantics. Unsupported/malformed evidence fails closed at the reader. */
export function decodeQqqDirectionalGexProfile(value: unknown): CompactGexStrike[] {
  if (!value || typeof value !== 'object') throw Error('Invalid directional GEX transport');
  if((value as {version?:unknown}).version===2){
    const points=decodeQqqChartProfile({...value,version:1},QQQ_DIRECTIONAL_GEX_FIELDS);
    return points.map(point=>({isCallWall:false,isPutWall:false,isGammaFlip:false,...point})) as CompactGexStrike[];
  }
  const packed = value as QqqDirectionalGexTransport;
  const allowed = new Set<string>(QQQ_DIRECTIONAL_GEX_FIELDS);
  if (packed.version !== 1 || !packed.constants || typeof packed.constants !== 'object' || Array.isArray(packed.constants)
    || !Array.isArray(packed.columns) || !Array.isArray(packed.rows)) throw Error('Invalid directional GEX transport');
  const keys = [...Object.keys(packed.constants), ...packed.columns];
  if (keys.some(key => !allowed.has(key)) || new Set(keys).size !== keys.length) throw Error('Invalid directional GEX columns');
  return packed.rows.map(row => {
    if (!Array.isArray(row) || row.length !== packed.columns.length) throw Error('Invalid directional GEX row');
    return { isCallWall: false, isPutWall: false, isGammaFlip: false, ...packed.constants,
      ...Object.fromEntries(packed.columns.flatMap((key, index) => row[index] === null ? [] : [[key, row[index]]])),
    } as CompactGexStrike;
  });
}
