/** Selected E9249 stack without historical candidate factories. Research only. */
import assert from 'node:assert/strict';
import { freezeStrategyData, assertFixedStrategyParams, type BarStrategyModule, type StrategyIntent, type StrategySnapshot, type StrategyObject } from '../../strategy-module-v2';
import {createE9264UnitKernel} from './unit-kernel';
type Open = Extract<StrategyIntent, {
    kind: 'open-spread';
}>;
type Safer = {
    id: string;
    trigger: number;
    dte: number;
    width: number;
    gap: number;
};
function narrow(o: Open, s: Readonly<StrategySnapshot>, fraction: number, ceiling = Number(o.risk.ratioMax)): Open {
    const q = (((s.market.chain as StrategyObject).expirations as StrategyObject[]).find(e => e.date === o.contract.expiry)?.puts ?? []) as StrategyObject[], a = q.find(x => x.strike === o.contract.shortStrike), b = q.find(x => x.strike === o.contract.longStrike), width = Number(o.contract.shortStrike) - Number(o.contract.longStrike);
    if (!a || !b)
        return o;
    const choices = q.filter(x => Number(x.bid) >= 0 && Number(x.ask) > 0 && Number.isFinite(x.delta) && Number(x.delta) < 0).filter(x => { const w = Number(a.strike) - Number(x.strike), c = Number(a.bid) - Number(x.ask), r = c / (w - c); return w > 0 && w <= width * fraction + 1e-9 && c > 0 && w - c > 0 && r >= Number(o.risk.ratioMin) && r <= ceiling; });
    choices.sort((x, y) => Number(x.strike) - Number(y.strike));
    const chosen = choices[0];
    if (!chosen)
        return o;
    const risk: StrategyObject = { ...o.risk, quantity: 1, multiplier: 1 };
    if (risk.longProtectionFallback !== undefined)
        risk.longProtectionFallback = { maximumWidth: width * fraction };
    return { ...o, contract: { ...o.contract, longStrike: Number(chosen.strike), multiplier: 1 }, risk };
}
export const selectedNativeStrategy: BarStrategyModule = (() => {
    const id = "E9332";
    const profile = {"id":"E9332","kind":"share-adx35-with40-on-E9328","feature":"adx14","from":35,"to":40};
    const root = createE9264UnitKernel({"e64":["E64.0.0","E64.1.3","E64.3.0","E64.6.0"],"rescue":["E67","E70","E76","E82","E84","E100","E102","E108","E110","E116"],"broad":["E126","E128","E132","E135","E137","E139","E140","E141","E142","E143","E146","E148","E149","E151","E152","E154","E156","E158","E160","E162","E164","E166","E168","E170","E172","E176","E178","E182","E184","E186","E190","E198","E200"],"score":["E202","E204","E206","E208","E210","E216","E220","E222","E226","E228","E230","E234"],"armRelease":true,"probe":true,"upstream":true,"residual":true,"c4Readmission":true,"upstreamRawRelease":true,"upstreamC4Release":true,"upstreamQuality":true,"upstreamReplacement":false,"upstreamVeto":false,"upstreamAdxRelease":true,"mergeVeto":true,"logicEdits":[],"logicDesign":"E9332-native-cut-sharing-v1"});
    const params = freezeStrategyData({ parent: 'E9328', profile, admission: (root.params as any).admission, quantity: 1, multiplier: 1, commission: 0, capitalLimits: 'none' }), check = (p: any) => assertFixedStrategyParams(p, params);
    return { manifest: { sdkVersion: 2, id: 'EB8.' + id.slice(1), version: id + '-compact-fixed-stack-v1', researchOnly: true, migration: { complete: true, missing: [] } }, params,
        initialize(p) { check(p); return { parent: root.initialize(root.params), paused: false }; },
        onFeedback(i) { check(i.params); const s = i.state as any; return { ...s, parent: root.onFeedback!({ ...i, state: s.parent, params: root.params }) }; },
        onBar(i) {
            check(i.params);
            const s = i.state as any, r = root.onBar({ ...i, state: s.parent, params: root.params }), m = i.snapshot.market as any, t = m.restorationResearch, f = m.extremePathResearch, spot = Number(m.qqq.close), n = i.snapshot.positions.length;
            let changed = 0, blocked = 0, addedExits = 0;
            let intents = r.intents.map(o => o.kind === 'open-spread' && o.risk.sourceAccount === 'portfolio' ? { ...o, contract: { ...o.contract, multiplier: 1 }, risk: { ...o.risk, quantity: 1, multiplier: 1 } } : o);
            intents = intents.map(o => {
                if (o.kind !== 'open-spread' || o.risk.sourceAccount !== 'portfolio')
                    return o;
                let a = o;
                ;
                {
                    const b = n >= 12 ? narrow(a, i.snapshot, .4) : a;
                    ;
                    return b;
                }
                return a;
            });
            {
                const owned = new Set(intents.filter(o => o.kind === 'close-position').map(o => (o as any).positionId));
                const exits: StrategyIntent[] = n >= 10 ? i.snapshot.positions.flatMap(p => { if (owned.has(String(p.id)) || !(Number(p.markPnl) / Number(p.creditReceived) >= .1))
                    return []; return [{ kind: 'close-position', key: `close:delayed:${String(p.id)}:${i.snapshot.asOf}`, positionId: String(p.id), reason: 'profit-target', minimumUnweightedPnl: 0 }]; }) : [];
                intents = [...exits, ...intents.map(o => o.kind === 'open-spread' && o.risk.sourceAccount === 'portfolio' && n >= 10 ? narrow(o, i.snapshot, .8) : o)];
            }
            ;
            const active = Number(f.range63) >= .15 && Number(f.roc63) > 0 && Number(f.roc63) <= .075 && Number(f.rv20) <= Number(f.rv63), width = null;
            ;
            const arm = active && Number(f.drawdown20) >= Number(f.rv20) / Math.sqrt(252), recovered = spot >= Number(t.sma20), paused = arm || (s.paused && !recovered);
            intents = intents.filter(o => { if (paused && o.kind === 'open-spread' && o.risk.sourceAccount === 'portfolio') {
                blocked++;
                return false;
            } return true; });
            if (active) {
                const owned = new Set(intents.filter(o => o.kind === 'close-position').map(o => (o as any).positionId)), extra: StrategyIntent[] = [];
                for (const p of i.snapshot.positions) {
                    const id = String(p.id), credit = Number(p.creditReceived);
                    if (owned.has(id) || !(credit > 0 && Number(p.markPnl) / credit >= .1) || Number(p.width) / spot < .045)
                        continue;
                    extra.push({ kind: 'close-position', key: `close:extreme-profit:EB8.9230:${id}:${i.snapshot.asOf}`, positionId: id, reason: 'extreme-profit-release', minimumUnweightedPnl: .01 });
                    addedExits++;
                }
                intents = [...extra, ...intents];
            }
            const positions = new Map((i.snapshot.positions as any[]).map(p => [String(p.id), p]));
            intents = intents.map(o => { if (o.kind !== 'close-position' || o.reason !== 'profit-target')
                return o; const p = positions.get(o.positionId); if (!p)
                return o; const floor = Math.max(Number(o.minimumUnweightedPnl ?? 0), Math.min(.255 * Number(p.creditReceived), Math.max(0, Number(p.markPnl)))); return floor > Number(o.minimumUnweightedPnl ?? 0) + 1e-9 ? { ...o, minimumUnweightedPnl: floor } : o; });
            return { ...r, state: { parent: r.state, paused }, intents, plots: { ...r.plots, extremeProtection: { active, changedOrders: changed, effectiveWidth: width }, marketProtection: { entryPaused: paused, arm, recovered, blockedEntries: blocked }, research: { id, changed, blocked, addedExits } } };
        } };
})();
