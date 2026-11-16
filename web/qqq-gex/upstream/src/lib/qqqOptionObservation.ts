import type { PcsGexExpiry } from '@/types/qqqGex';
import { qqqGexDisplaySideValid, qqqGexDisplayStrikeValid, qqqLosslessGexDefinitionSupported } from './qqqGexInputQuality';

/** Snapshot volumes describe total contracts, not buyer/seller initiated flow. */
export function qqqOptionOverview(profile: readonly PcsGexExpiry['fullGexProfile'][number][]) {
  const definitions = new Set(profile.map(point => `${point.calculationVersion ?? 'legacy'}:${point.gexUnit ?? 'unknown'}`));
  const side = (kind: 'call' | 'put') => {
    const volumeKey = kind === 'call' ? 'callVolume' : 'putVolume';
    const oiKey = kind === 'call' ? 'callOi' : 'putOi';
    const gexKey = kind === 'call' ? 'callGex' : 'putGex';
    const gexPoints = definitions.size === 1 ? profile.filter(point =>
      qqqLosslessGexDefinitionSupported(point) || point.calculationVersion === 'qqq-exposure-gamma-model-v1'
        ? qqqGexDisplaySideValid(point, kind) : qqqGexDisplayStrikeValid(point) && Number.isFinite(point[gexKey])) : [];
    const absoluteGex = gexPoints.length ? gexPoints.reduce((sum, point) => sum + Math.abs(point[gexKey]), 0) : null;
    const valid = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const volumePoints = profile.filter(point => valid(point[volumeKey]));
    const oiPoints = profile.filter(point => valid(point[oiKey]));
    return { absoluteGex, volume: volumePoints.length ? volumePoints.reduce((sum, point) => sum + point[volumeKey]!, 0) : null,
      oi: oiPoints.length ? oiPoints.reduce((sum, point) => sum + point[oiKey]!, 0) : null,
      volumeCoverage: volumePoints.length, oiCoverage: oiPoints.length, gexCoverage: gexPoints.length,
      top: [...volumePoints.reduce((totals, point) => totals.set(point.strike, (totals.get(point.strike) ?? 0) + point[volumeKey]!), new Map<number, number>())].filter(([,volume]) => volume > 0).sort(([a,x],[b,y]) => y-x || a-b).slice(0,3).map(([strike,volume]) => ({strike,volume})) };
  };
  const call = side('call'), put = side('put');
  const completeVolume = profile.length > 0 && call.volumeCoverage === profile.length && put.volumeCoverage === profile.length;
  const total = (call.volume ?? 0) + (put.volume ?? 0);
  return { call, put, strikes: profile.length, completeVolume,
    putCallRatio: call.volume !== null && call.volume > 0 && put.volume !== null ? put.volume / call.volume : null,
    putShare: call.volume !== null && put.volume !== null && total > 0 ? put.volume / total * 100 : null };
}
