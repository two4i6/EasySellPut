import { qqqMarketSession } from './qqqMarketSession';
import type { QqqIntradayBar, QqqIntradayGexPoint, QqqIntradayWallSnapshot } from './qqqIntradaySetup';
/** Display-only observations. No eligibility, entry, exit or directional signal output. */
export const qqqObservationBandPolicy = { ema: 20, atr: 10, multiplier: 2, confirmBars: 2, gexMaxAgeSeconds: 600, barSeconds: 120 } as const;
export type QqqObservationZone = {
    anchor: number;
    lower: number;
    upper: number;
    source: string;
    sourceTime: number;
    confirmedAt: number;
};
export type QqqObservationBandPoint = {
    time: number;
    low: QqqObservationZone | null;
    high: QqqObservationZone | null;
    reason: 'READY' | 'CONFIRMING' | 'OVERLAP';
    gexStale: boolean;
};
export type QqqKeltnerPoint = {
    time: number;
    basis: number;
    upper: number;
    lower: number;
    atr: number;
    connect: boolean;
};
type Level = {
    source: string;
    value: number;
    sourceTime: number;
};
type ZoneState = {
    held: QqqObservationZone | null;
    pending: Level | null;
    count: number;
};
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const empty = (): ZoneState => ({ held: null, pending: null, count: 0 });
export function buildQqqChartObservationBands(input: {
    bars: readonly QqqIntradayBar[];
    vwap: readonly QqqIntradayGexPoint[];
    wallHistory: readonly QqqIntradayWallSnapshot[];
    gammaFlip: readonly QqqIntradayGexPoint[];
    /** Only completed bars enter observations; timestamps identify the bar's start. */
    asOf: number;
    /** Independent price observations; never alters a trade admission window. */
    extendedHours?: boolean;
}) {
    const bars = [...new Map(input.bars.filter(b => Number.isFinite(b.time) && valid(b.close) && valid(b.high) && valid(b.low) && b.high >= b.low && b.time + 120 <= input.asOf).map(b => [b.time, b])).values()].sort((a, b) => a.time - b.time);
    const cursor = <T extends {
        time: number;
    }>(points: readonly T[]) => {
        const sorted = points.filter(p => Number.isFinite(p.time)).slice().sort((a, b) => a.time - b.time);
        let index = -1;
        return (time: number) => { while (index + 1 < sorted.length && sorted[index + 1]!.time <= time)
            index++; return sorted[index] ?? null; };
    };
    const vwapAt = cursor(input.vwap), wallAt = cursor(input.wallHistory), flipAt = cursor(input.gammaFlip);
    const zones: QqqObservationBandPoint[] = [];
    const channel: QqqKeltnerPoint[] = [];
    let date = '', sessionKey = '', previousTime = 0, previousClose: number | null = null, n = 0, ema = 0, rma = 0, trSum = 0;
    let sessionLow = Infinity, sessionHigh = -Infinity, openingLow = Infinity, openingHigh = -Infinity, openingCount = 0;
    let lowState = empty(), highState = empty(), hasSessionOpen = false;
    let recentTr: number[] = [];
    const advance = (state: ZoneState, candidate: Level | null, levels: Level[], half: number, atr: number, spot: number, side: 'low' | 'high', time: number): QqqObservationZone | null => {
        const zone = (level: Level, confirmedAt: number): QqqObservationZone => ({ anchor: level.value, lower: level.value - half, upper: level.value + half, source: level.source, sourceTime: level.sourceTime, confirmedAt });
        const usable = (z: QqqObservationZone) => side === 'low' ? spot >= z.lower - .5 * atr : spot <= z.upper + .5 * atr;
        if (state.held) {
            const current = levels.find(l => l.source === state.held!.source);
            if (!current || Math.abs(current.value - state.held.anchor) > .5 * atr)
                state.held = null;
            else {
                const updated = zone(current, state.held.confirmedAt);
                state.held = usable(updated) ? updated : null;
            }
        }
        if (!candidate || !usable(zone(candidate, time))) {
            state.pending = null;
            state.count = 0;
            return state.held;
        }
        if (state.held && (state.held.source === candidate.source || Math.abs(state.held.anchor - candidate.value) <= .25 * atr)) {
            state.pending = null;
            state.count = 0;
            return state.held;
        }
        const agrees = state.pending?.source === candidate.source && Math.abs(state.pending.value - candidate.value) <= .25 * atr;
        state.count = agrees ? state.count + 1 : 1;
        state.pending = candidate;
        if (state.count >= 2) {
            state.held = zone(candidate, time);
            state.pending = null;
            state.count = 0;
        }
        return state.held;
    };
    for (const bar of bars) {
        const session = qqqMarketSession(new Date(bar.time * 1000));
        const minute = session.minute;
        if (!(input.extendedHours ? session.stockAcquisitionOpen : session.stocksOpen)) continue;
        const nextDate = session.date;
        const kind = session.premarket ? 'pre' : session.postmarket ? 'post' : 'regular';
        const nextKey = `${nextDate}:${kind}`;
        const reset = nextKey !== sessionKey || (previousTime > 0 && bar.time - previousTime > 300);
        if (reset) {
            if (nextKey !== sessionKey) {
                sessionLow = Infinity;
                sessionHigh = -Infinity;
                openingLow = Infinity;
                openingHigh = -Infinity;
                openingCount = 0;
                hasSessionOpen = kind === 'regular' && minute === session.openMinute;
            }
            date = nextDate;
            sessionKey = nextKey;
            previousClose = null;
            n = 0;
            ema = 0;
            rma = 0;
            trSum = 0;
            recentTr = [];
            lowState = empty();
            highState = empty();
        }
        const high = bar.high!, low = bar.low!;
        const tr = previousClose === null ? high - low : Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
        n++;
        ema = n === 1 ? bar.close : ema + 2 / 21 * (bar.close - ema);
        trSum += tr;
        if (n === 10)
            rma = trSum / 10;
        else if (n > 10)
            rma += (tr - rma) / 10;
        previousClose = bar.close;
        previousTime = bar.time;
        recentTr.push(tr);
        if (recentTr.length > 10)
            recentTr.shift();
        sessionLow = Math.min(sessionLow, low);
        sessionHigh = Math.max(sessionHigh, high);
        if (kind === 'regular' && minute < session.openMinute + 15) {
            openingLow = Math.min(openingLow, low);
            openingHigh = Math.max(openingHigh, high);
            openingCount++;
        }
        if (n >= 20 && rma > 0)
            channel.push({ time: bar.time, basis: ema, upper: ema + 2 * rma, lower: ema - 2 * rma, atr: rma, connect: n > 20 && !reset });
        const atr = recentTr.reduce((sum, v) => sum + v, 0) / recentTr.length;
        if (n < 3 || atr <= 0)
            continue;
        const half = Math.max(bar.close * .00035, Math.min(atr * .35, bar.close * .0012));
        const levels: Level[] = [{ source: hasSessionOpen ? '日内低' : '窗口低', value: sessionLow, sourceTime: bar.time }, { source: hasSessionOpen ? '日内高' : '窗口高', value: sessionHigh, sourceTime: bar.time }];
        if (openingCount >= 3)
            levels.push({ source: '开盘15低', value: openingLow, sourceTime: bar.time }, { source: '开盘15高', value: openingHigh, sourceTime: bar.time });
        const vwap = vwapAt(bar.time);
        if (vwap && valid(vwap.value) && dateFormatter.format(new Date(vwap.time * 1000)) === date)
            levels.push({ source: hasSessionOpen ? 'VWAP' : '窗口VWAP', value: vwap.value, sourceTime: vwap.time });
        const wall = wallAt(bar.time), flip = flipAt(bar.time);
        const fresh = (time: number) => bar.time - time <= 600 && dateFormatter.format(new Date(time * 1000)) === date;
        if (wall && fresh(wall.time)) {
            if (valid(wall.putWallPrice))
                levels.push({ source: 'Put墙', value: wall.putWallPrice, sourceTime: wall.time });
            if (valid(wall.callWallPrice))
                levels.push({ source: 'Call墙', value: wall.callWallPrice, sourceTime: wall.time });
        }
        if (flip && fresh(flip.time) && valid(flip.value))
            levels.push({ source: 'Flip', value: flip.value, sourceTime: flip.time });
        const support = levels.filter(l => ['日内低', '窗口低', '开盘15低', 'VWAP', '窗口VWAP', 'Put墙', 'Flip'].includes(l.source) && l.value <= bar.close + half).sort((a, b) => Math.abs(a.value - bar.close) - Math.abs(b.value - bar.close))[0] ?? null;
        const resistance = levels.filter(l => ['日内高', '窗口高', '开盘15高', 'VWAP', '窗口VWAP', 'Call墙', 'Flip'].includes(l.source) && l.value >= bar.close - half && l.value > (support?.value ?? -Infinity) + 2 * half).sort((a, b) => Math.abs(a.value - bar.close) - Math.abs(b.value - bar.close))[0] ?? null;
        let lower = advance(lowState, support, levels, half, atr, bar.close, 'low', bar.time);
        let upper = advance(highState, resistance, levels, half, atr, bar.close, 'high', bar.time);
        const overlap = Boolean(lower && upper && upper.lower <= lower.upper);
        if (overlap) {
            lower = null;
            upper = null;
        }
        zones.push({ time: bar.time, low: lower, high: upper, reason: overlap ? 'OVERLAP' : lower && upper ? 'READY' : 'CONFIRMING', gexStale: !wall || !fresh(wall.time) });
    }
    return { channel, zones };
}
