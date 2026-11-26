import { expect, test } from 'bun:test';
import { buildDirectionalChartMarkers, type DirectionalChartSignal } from './qqqDirectionalChartMarkers';
const anchor = '2026-10-08T14:00:00Z';
const bar = {time:Date.parse(anchor)/1000,close:750,high:751,low:749};
const signal = { signalId:'entry-1',anchorBar:anchor,intent:'ENTRY',stage:'TRIGGERED',direction:'LONG',entryZone:{low:749,high:751},riskPlan:null,validUntil:'2026-10-08T14:05:00Z' } as DirectionalChartSignal;
test('same emitted record keeps its candle and identity even after expiry', () => {
 const [marker] = buildDirectionalChartMarkers([signal,signal],[bar]);
 expect(buildDirectionalChartMarkers([signal,signal],[bar])).toHaveLength(1);
 expect(marker?.id).toBe(signal.signalId);expect(marker?.time).toBe(bar.time);
 expect(marker?.text).toContain('机会待复核');expect(marker?.position).toBe('atPriceBottom');
});
test('missing candles, unissued observations and blocked decisions do not invent markers', () => {
 expect(buildDirectionalChartMarkers([signal],[])).toEqual([]);
 expect(buildDirectionalChartMarkers([{...signal,signalId:null} as DirectionalChartSignal],[bar])).toEqual([]);
 expect(buildDirectionalChartMarkers([{...signal,blockers:['GEX_DATA_STALE'],status:'INSUFFICIENT_DATA'} as DirectionalChartSignal],[bar])).toEqual([]);
});
test('risk and candidate stages have distinct names and directional placement', () => {
 const risk = {...signal,intent:'RISK_CUE',stage:'STOP_RISK',riskPlan:{atRisk:'SC',triggerZone:{low:751,high:752},recoveryLevel:750,severity:'STOP'}} as DirectionalChartSignal;
 expect(buildDirectionalChartMarkers([risk],[bar])[0]?.text).toBe('提示·风险确认 卖涨');
 expect(buildDirectionalChartMarkers([risk],[bar])[0]?.shape).toBe('circle');
 expect(buildDirectionalChartMarkers([{...signal,stage:'ARMED'} as DirectionalChartSignal],[bar])[0]?.text).toContain('等待确认');
});
