/** Frozen P6.3922 admission dependency; preserves missing-value and half-open semantics. */
import { trailingStateRun, lastThreeStateSequence, createDecisionMemo } from '../current-bar-facts-v4';
const memoValue = <T>(row: Row, key: string, compute: () => T): T => {
    const memo = (row as unknown as {
        evaluationMemo?: ReturnType<typeof createDecisionMemo>;
    }).evaluationMemo;
    return memo ? memo(key, compute) : compute();
};
import type { PcsDynamicEntryContext, PcsDynamicMarketState } from '../../engines/leveraged-overlay/types/input';
type State = PcsDynamicMarketState & {
    regime: string;
    roc5?: number;
    roc20?: number;
};
type Row = {
    market: State;
    history: State[];
    selection?: {
        selectedNoTouchLower?: number | null;
        selectedSigma?: 1 | 1.5 | 2 | 2.5;
        openCredit?: number;
    };
};
type Rule = readonly [
    string,
    (row: Row) => boolean
];
import { isPcsCandidate3ExtraRelease } from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';
import { isPcsCandidate3TimingWindow } from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';
import { isPcsV12GateBlocked } from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';
import { isPcsV121Simple5Release } from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';
import { evaluatePcsRiskEnvelope } from '../../engines/leveraged-overlay/v2/strategies/pcs-risk-envelope';
import { evaluatePcsV123Gate } from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';
function contextRow_db5cca(context: PcsDynamicEntryContext): Row {
    const market = {
        ...context,
        // BacktestTraceEntry uses the shorter state names; the public dynamic
        // seam uses symbol-qualified names to avoid ambiguity with TQQQ.
        roc20: context.qqqROC20,
        roc5: context.qqqROC5,
    } as unknown as State;
    const row = {
        market: market,
        history: context.history.map((state) => ({
            ...state,
            roc20: state.qqqROC20,
            roc5: state.qqqROC5,
        })) as State[],
        selection: {
            selectedNoTouchLower: context.selectedNoTouchLower,
            selectedSigma: context.selectedSigma,
            openCredit: context.openCredit,
        },
    };
    Object.defineProperty(row, 'evaluationMemo', { value: createDecisionMemo() });
    return row;
}
const finite_db5cca = (value: number | null | undefined, fallback: number) => value ?? fallback;
const vix_db5cca = (row: Row) => finite_db5cca(row.market.vix, Number.POSITIVE_INFINITY);
function currentBlock_db5cca(market: State): boolean {
    return (market.regime === 'BULL' && market.slowSubregime === 'SR01' && finite_db5cca(market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2 && finite_db5cca(market.adx14, Number.NEGATIVE_INFINITY) >= 29)
        || (market.regime === 'BULL' && market.slowSubregime === 'SR02' && vix_db5cca({ market: market } as Row) >= 15 && vix_db5cca({ market: market } as Row) < 18 && finite_db5cca(market.adx14, Number.NEGATIVE_INFINITY) >= 40)
        || (market.regime === 'RISK_ON_WEAKENING' && market.slowSubregime === 'SR01' && finite_db5cca(market.adx14, Number.POSITIVE_INFINITY) < 12);
}
const rv_db5cca = (row: Row) => finite_db5cca(row.market.tqqqRealisedVol20d, Number.NEGATIVE_INFINITY);
function priceSmaBlock_db5cca(market: State): boolean {
    return market.regime === 'BULL' && market.slowSubregime === 'SR01' && finite_db5cca(market.adx14, Number.POSITIVE_INFINITY) < 18 && rv_db5cca({ market: market } as Row) >= .6 && finite_db5cca(market.priceVsSma200Pct, Number.NEGATIVE_INFINITY) >= .1;
}
const adx_db5cca = (row: Row) => finite_db5cca(row.market.adx14, Number.POSITIVE_INFINITY);
function currentArmEquivalent_db5cca(context: PcsDynamicEntryContext, row: Row): boolean {
    if (context.safetyConditionsMet === false || context.streakCooldownBlocked === true)
        return false;
    const currentSignal = context.normalP4SignalPassed ?? context.normalP4GatePassed ?? false;
    if (!currentSignal && !isPcsCandidate3TimingWindow({ regime: row.market.regime, vix: vix_db5cca(row), adx14: adx_db5cca(row) }))
        return false;
    const input = {
        enabled: true,
        regime: row.market.regime,
        slowSubregime: row.market.slowSubregime,
        vix: row.market.vix,
        adx14: row.market.adx14,
        priceExtensionAtr: row.market.priceExtensionAtr,
        priceVsSma200Pct: row.market.priceVsSma200Pct,
        tqqqRealisedVol20d: row.market.tqqqRealisedVol20d,
        roc20: row.market.roc20,
        roc5: row.market.roc5,
        rsi14: row.market.rsi14,
        weakeningSignalCount: row.market.weakeningSignalCount,
        drawdownFromRecentHighPct: row.market.drawdownFromRecentHighPct,
        selectedNoTouchLower: row.selection?.selectedNoTouchLower,
        selectedSigma: row.selection?.selectedSigma,
    };
    const extra = isPcsCandidate3ExtraRelease(input, 'bull_sr02_rv_adx');
    const v121Blocked = isPcsV12GateBlocked({ ...input, v11ReleaseMode: 'rv20_lt_067_or_sr02_adx20' });
    const v121Released = !v121Blocked
        || isPcsV121Simple5Release(input)
        || extra
        || evaluatePcsRiskEnvelope(input, 'candidate4_full_only_v1').band !== 'BLOCK';
    const v123 = evaluatePcsV123Gate({ ...input, b30ReleaseLower: .38 });
    const v123Released = v123.blockedBy.length === 0
        || evaluatePcsRiskEnvelope(input, 'candidate4_full_v1').band === 'FULL'
        || extra;
    return v121Released && v123Released;
}
function p1Compact_db5cca(row: Row): boolean {
    const x = vix_db5cca(row);
    return (row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && x < 17 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2.5 && adx_db5cca(row) < 21 && (rv_db5cca(row) < .5 || rv_db5cca(row) >= .6))
        || (row.market.slowSubregime === 'SR02' && rv_db5cca(row) >= .6 && adx_db5cca(row) < 20 && ((row.market.regime === 'RISK_ON_EXTENDED' && x >= 20) || (row.market.regime === 'BULL' && row.history.slice(-3).length === 3 && row.history.slice(-3).every((state) => state.regime === 'BULL' && state.slowSubregime === 'SR02' && finite_db5cca(state.tqqqRealisedVol20d, Number.NEGATIVE_INFINITY) >= .6 && finite_db5cca(state.adx14, Number.POSITIVE_INFINITY) < 20))))
        || (row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && x >= 20 && adx_db5cca(row) < 15);
}
function candidateAState_db5cca(market: State): boolean {
    const a = finite_db5cca(market.adx14, Number.POSITIVE_INFINITY);
    const x = vix_db5cca({ market: market } as Row);
    return (market.regime === 'SIDEWAYS' && (a < 12 || (x > 30 && a >= 20 && a < 30) || (x >= 28 && x <= 30 && a >= 12 && a < 20)))
        || (market.regime === 'BULL' && market.slowSubregime === 'SR01' && x < 12 && a < 12)
        || ((market.regime === 'BULL' || market.regime === 'RISK_ON_WEAKENING') && x < 12 && a >= 30)
        || (market.regime === 'RANGE_BOUND' && market.slowSubregime === 'SR01' && x >= 12 && x < 14 && a >= 12 && a < 20);
}
const band_db5cca = (value: number, min?: number, max?: number) => (min === undefined || value >= min) && (max === undefined || value < max);
const lower_db5cca = (row: Row) => finite_db5cca(row.selection?.selectedNoTouchLower, Number.NEGATIVE_INFINITY);
const sigma_db5cca = (row: Row) => row.selection?.selectedSigma;
const rules_db5cca: readonly Rule[] = [
    ['E322', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 20 && adx_db5cca(r) < 25 && finite_db5cca(r.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY) >= .05 && finite_db5cca(r.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY) < .1 && rv_db5cca(r) >= .5 && finite_db5cca(r.market.roc20, Number.POSITIVE_INFINITY) <= -.02 && finite_db5cca(r.market.weakeningSignalCount, 0) >= 2 && lower_db5cca(r) >= .45 && lower_db5cca(r) < .49 && sigma_db5cca(r) === 2.5],
    ['E326', r => r.market.regime === 'RISK_ON_WEAKENING' && r.market.slowSubregime === 'CURRENT' && lower_db5cca(r) >= .45 && lower_db5cca(r) < .49 && sigma_db5cca(r) === 2.5],
    ['E329', r => r.market.regime === 'SIDEWAYS' && vix_db5cca(r) >= 25 && adx_db5cca(r) >= 20 && adx_db5cca(r) < 30 && sigma_db5cca(r) === 2.5],
    ['E334', r => vix_db5cca(r) >= 17 && vix_db5cca(r) < 20 && adx_db5cca(r) >= 25 && adx_db5cca(r) < 30 && sigma_db5cca(r) === 2.5],
    ['E338', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'CURRENT' && sigma_db5cca(r) === 2.5],
    ['E352', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'CURRENT' && sigma_db5cca(r) === 2.5],
    ['E355', r => rv_db5cca(r) >= .5 && rv_db5cca(r) < .6 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4 && sigma_db5cca(r) === 2.5],
    ['E359', r => rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) >= .49 && sigma_db5cca(r) === 2.5],
    ['E363', r => rv_db5cca(r) >= .6 && rv_db5cca(r) < .67 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4 && (sigma_db5cca(r) ?? Number.NEGATIVE_INFINITY) >= 2 && (sigma_db5cca(r) ?? Number.NEGATIVE_INFINITY) < 3],
    ['E367', r => rv_db5cca(r) >= .6 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 2],
    ['E371', r => rv_db5cca(r) >= .4 && rv_db5cca(r) < .6 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 2.5],
    ['E381', r => vix_db5cca(r) >= 17 && vix_db5cca(r) < 20 && adx_db5cca(r) >= 25 && adx_db5cca(r) < 30 && (sigma_db5cca(r) ?? Number.NEGATIVE_INFINITY) >= 2 && (sigma_db5cca(r) ?? Number.NEGATIVE_INFINITY) < 3],
    ['E388', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'CURRENT' && (sigma_db5cca(r) ?? Number.NEGATIVE_INFINITY) >= 2 && (sigma_db5cca(r) ?? Number.NEGATIVE_INFINITY) < 3],
    ['E392', r => rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4 && sigma_db5cca(r) === 1.5],
    ['E396', r => rv_db5cca(r) < .4 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 1.5],
    ['E400', r => rv_db5cca(r) >= .67 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4 && sigma_db5cca(r) === 2 && vix_db5cca(r) < 20],
    ['E403', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 20 && adx_db5cca(r) < 25 && rv_db5cca(r) >= .67 && lower_db5cca(r) >= .4 && lower_db5cca(r) < .45 && sigma_db5cca(r) === 2],
    ['E411', r => r.market.regime === 'BULL' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) < .4 && lower_db5cca(r) >= .4 && lower_db5cca(r) < .45],
    ['E415', r => r.market.regime === 'BULL' && adx_db5cca(r) < 12 && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 2],
    ['E418', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && adx_db5cca(r) >= 20 && adx_db5cca(r) < 25 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 2.5],
    ['E421', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && adx_db5cca(r) < 12 && rv_db5cca(r) < .4 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 2.5],
    ['E424', r => r.market.regime === 'RISK_ON_EXTENDED' && adx_db5cca(r) >= 30 && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 2],
    ['E427', r => r.market.regime === 'RANGE_BOUND' && rv_db5cca(r) >= .67],
    ['E430', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR01' && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && sigma_db5cca(r) === 2.5],
    ['P4E0_BULL_SR01_RV40_50_SIGMA2', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR01' && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) < .4 && sigma_db5cca(r) === 2],
    ['P4E0_WEAKENING_SR01_RV58_70_SIGMA15', r => r.market.regime === 'RISK_ON_WEAKENING' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 20 && adx_db5cca(r) < 30 && rv_db5cca(r) >= .58 && rv_db5cca(r) < .7 && lower_db5cca(r) < .4 && sigma_db5cca(r) === 1.5],
    ['E433', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5],
    ['E436', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && adx_db5cca(r) < 12 && rv_db5cca(r) >= .5 && rv_db5cca(r) < .6],
    ['E439', r => vix_db5cca(r) < 17 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .5 && rv_db5cca(r) < .6 && sigma_db5cca(r) === 2.5],
    ['E442', r => vix_db5cca(r) >= 25 && rv_db5cca(r) >= .67 && lower_db5cca(r) >= .4 && lower_db5cca(r) < .45],
    ['E445', r => r.market.slowSubregime === 'SR02' && adx_db5cca(r) >= 20 && adx_db5cca(r) < 25 && rv_db5cca(r) < .4 && lower_db5cca(r) < .35],
    ['E448', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR02' && adx_db5cca(r) < 12 && rv_db5cca(r) < .4 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4],
    ['E454', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && adx_db5cca(r) >= 20 && adx_db5cca(r) < 25 && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4],
    ['E460', r => vix_db5cca(r) >= 25 && adx_db5cca(r) >= 30 && lower_db5cca(r) >= .45 && lower_db5cca(r) < .49],
    ['E464', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) >= .4 && lower_db5cca(r) < .45 && sigma_db5cca(r) === 2.5],
    ['E468', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) >= .45 && lower_db5cca(r) < .49 && sigma_db5cca(r) === 2.5],
    ['E471', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) < 17 && adx_db5cca(r) < 12 && rv_db5cca(r) >= .5 && rv_db5cca(r) < .6 && lower_db5cca(r) >= .4 && lower_db5cca(r) < .45 && sigma_db5cca(r) === 2],
    ['E474', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) >= 17 && vix_db5cca(r) < 20 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4 && sigma_db5cca(r) === 2],
    ['E477', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) >= 20 && vix_db5cca(r) < 25 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .5 && rv_db5cca(r) < .6 && lower_db5cca(r) >= .45 && lower_db5cca(r) < .49 && sigma_db5cca(r) === 2.5],
    ['E480', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .5 && rv_db5cca(r) < .6 && lower_db5cca(r) >= .4 && lower_db5cca(r) < .45 && sigma_db5cca(r) === 2],
    ['E483', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) >= 25 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .67 && lower_db5cca(r) >= .45 && lower_db5cca(r) < .49 && sigma_db5cca(r) === 2.5],
    ['E486', r => r.market.regime === 'RISK_ON_WEAKENING' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 25 && adx_db5cca(r) < 30 && rv_db5cca(r) >= .67 && lower_db5cca(r) >= .45 && lower_db5cca(r) < .49 && sigma_db5cca(r) === 2.5],
    ['E489', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) >= 17 && vix_db5cca(r) < 20 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .6 && rv_db5cca(r) < .67 && lower_db5cca(r) >= .49 && sigma_db5cca(r) === 2.5],
    ['E492', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 20 && adx_db5cca(r) < 25 && rv_db5cca(r) >= .6 && rv_db5cca(r) < .67 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 1.5],
    ['E495', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 30 && rv_db5cca(r) < .4 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4 && sigma_db5cca(r) === 2],
    ['E498', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) < 17 && adx_db5cca(r) < 12 && rv_db5cca(r) >= .67 && lower_db5cca(r) >= .45 && lower_db5cca(r) < .49 && sigma_db5cca(r) === 2.5],
    ['E501', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) >= 20 && vix_db5cca(r) < 25 && adx_db5cca(r) >= 25 && adx_db5cca(r) < 30 && rv_db5cca(r) >= .67 && lower_db5cca(r) >= .45 && lower_db5cca(r) < .49 && sigma_db5cca(r) === 2.5],
    ['E504', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) < 17 && adx_db5cca(r) < 12 && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 1.5],
    ['E507', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4 && sigma_db5cca(r) === 2.5],
    ['E510', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) < 17 && adx_db5cca(r) < 12 && rv_db5cca(r) < .4 && lower_db5cca(r) >= .4 && lower_db5cca(r) < .45 && sigma_db5cca(r) === 2.5],
    ['E513', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) < 17 && adx_db5cca(r) < 12 && rv_db5cca(r) < .4 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 2.5],
    ['E516', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 30 && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4 && sigma_db5cca(r) === 2.5],
    ['E522', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4 && sigma_db5cca(r) === 2],
    ['E526', r => r.market.regime === 'RANGE_BOUND' && (r.market.slowSubregime === 'SR01' || adx_db5cca(r) >= 12) && lower_db5cca(r) < .35 && sigma_db5cca(r) === 2],
    ['E530', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4 && sigma_db5cca(r) === 2.5],
    ['E533', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && adx_db5cca(r) >= 25 && adx_db5cca(r) < 30 && rv_db5cca(r) < .4 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4],
    ['E537', r => r.market.regime === 'SIDEWAYS' && vix_db5cca(r) < 17 && rv_db5cca(r) >= .5 && rv_db5cca(r) < .6],
    ['E541', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) >= 17 && vix_db5cca(r) < 20 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .5 && rv_db5cca(r) < .6 && lower_db5cca(r) >= .4 && lower_db5cca(r) < .45 && sigma_db5cca(r) === 2.5],
    ['E547', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) >= 20 && vix_db5cca(r) < 25 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .5 && rv_db5cca(r) < .6 && lower_db5cca(r) >= .45 && lower_db5cca(r) < .49 && sigma_db5cca(r) === 2.5],
    ['E551', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) >= 25 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) >= .45 && lower_db5cca(r) < .49 && sigma_db5cca(r) === 2.5],
    ['E557', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 30 && rv_db5cca(r) >= .5 && rv_db5cca(r) < .6 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 1.5],
    ['E561', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) < 17 && adx_db5cca(r) < 12 && rv_db5cca(r) < .4 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 2.5],
    ['E565', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) >= 17 && vix_db5cca(r) < 20 && adx_db5cca(r) < 12 && rv_db5cca(r) < .4 && lower_db5cca(r) >= .4 && lower_db5cca(r) < .45 && sigma_db5cca(r) === 2.5],
    ['E569', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) >= 25 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) < .4 && lower_db5cca(r) >= .4 && lower_db5cca(r) < .45 && sigma_db5cca(r) === 2.5],
    ['E575', r => r.market.regime === 'BULL' && adx_db5cca(r) >= 25 && adx_db5cca(r) < 30 && rv_db5cca(r) >= .5 && rv_db5cca(r) < .6 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 1.5],
    ['E585', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && adx_db5cca(r) >= 30 && rv_db5cca(r) < .4 && lower_db5cca(r) >= .45 && lower_db5cca(r) < .49 && sigma_db5cca(r) === 2.5],
    ['E590', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && adx_db5cca(r) >= 30 && rv_db5cca(r) < .4 && lower_db5cca(r) >= .45 && lower_db5cca(r) < .49 && sigma_db5cca(r) === 2.5],
    ['E596', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR01' && adx_db5cca(r) < 12 && rv_db5cca(r) >= .6 && rv_db5cca(r) < .67 && lower_db5cca(r) >= .4 && lower_db5cca(r) < .45 && sigma_db5cca(r) === 2.5],
    ['E601', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) >= 17 && vix_db5cca(r) < 20 && adx_db5cca(r) >= 30 && rv_db5cca(r) < .4 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 2.5],
    ['E611', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) >= 17 && vix_db5cca(r) < 20 && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .5 && rv_db5cca(r) < .6 && lower_db5cca(r) >= .4 && lower_db5cca(r) < .45 && sigma_db5cca(r) === 2],
    ['E614', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && adx_db5cca(r) >= 12 && adx_db5cca(r) < 20 && rv_db5cca(r) >= .5 && rv_db5cca(r) < .6 && lower_db5cca(r) >= .4 && lower_db5cca(r) < .45 && sigma_db5cca(r) === 2],
    ['E619', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) >= 25 && adx_db5cca(r) >= 30 && rv_db5cca(r) >= .67 && lower_db5cca(r) >= .49 && sigma_db5cca(r) === 2.5],
    ['E622', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'SR02' && adx_db5cca(r) >= 30 && rv_db5cca(r) >= .67 && lower_db5cca(r) >= .49 && sigma_db5cca(r) === 2.5],
    ['E630', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) < 17 && adx_db5cca(r) >= 30 && rv_db5cca(r) >= .4 && rv_db5cca(r) < .5 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 2],
    ['E638', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR02' && adx_db5cca(r) < 12 && rv_db5cca(r) >= .5 && rv_db5cca(r) < .6 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4 && sigma_db5cca(r) === 2],
    ['E646', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && vix_db5cca(r) < 17 && adx_db5cca(r) < 12 && rv_db5cca(r) < .4 && lower_db5cca(r) < .35 && sigma_db5cca(r) === 2],
    ['E656', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && adx_db5cca(r) < 12 && rv_db5cca(r) < .4 && lower_db5cca(r) >= .45 && lower_db5cca(r) < .49 && sigma_db5cca(r) === 2.5],
    ['E665', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && adx_db5cca(r) < 12 && rv_db5cca(r) >= .6 && rv_db5cca(r) < .67 && lower_db5cca(r) >= .4 && lower_db5cca(r) < .45 && sigma_db5cca(r) === 2.5],
    ['E671', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR01' && vix_db5cca(r) >= 20 && vix_db5cca(r) < 25 && adx_db5cca(r) >= 30 && rv_db5cca(r) >= .67 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4 && sigma_db5cca(r) === 2.5],
    // P4.E1: merge the adjacent ADX 25-30 slice into the registered E674
    // branch instead of adding another rule layer. All other E674 conditions
    // remain unchanged.
    ['E674', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR01' && adx_db5cca(r) >= 25 && rv_db5cca(r) >= .67 && lower_db5cca(r) >= .35 && lower_db5cca(r) < .4 && sigma_db5cca(r) === 2.5],
];
function finalCurrentBarReject_db5cca(row: Row, includeP4E2Protection = true): string | undefined {
    const market = row.market;
    const currentVix = vix_db5cca(row);
    const currentRv = rv_db5cca(row);
    const currentAdx = adx_db5cca(row);
    // E222 was historically applied only when the separate base arm produced
    // the same date. A current-bar profile has no base-arm membership signal;
    // applying it to every contract path incorrectly vetoes valid pool rows, so
    // the merged current-bar builder intentionally omits that cross-arm veto.
    const extended = market.regime === 'RISK_ON_EXTENDED' && market.slowSubregime === 'SR01' && currentVix < 20 && currentRv >= .5 && currentRv < .6 && currentAdx >= 20 && currentAdx < 30;
    const bullPe21 = market.regime === 'BULL' && market.slowSubregime === 'SR02' && currentVix < 15 && currentRv >= .5 && currentRv < .6 && currentAdx >= 20 && currentAdx < 30 && finite_db5cca(market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2.1;
    const extendedSr02 = market.regime === 'RISK_ON_EXTENDED' && market.slowSubregime === 'SR02' && currentVix < 18 && currentRv >= .45 && currentRv < .55 && currentAdx < 12 && finite_db5cca(market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2.1;
    const weakeningCompact = market.regime === 'RISK_ON_WEAKENING' && market.slowSubregime === 'SR02' && currentVix < 17 && currentAdx >= 12 && currentAdx < 17 && currentRv < .4;
    const bullSr01TrendExtension = market.regime === 'BULL' && market.slowSubregime === 'SR01' && currentVix < 18 && currentAdx >= 20 && currentAdx < 30 && currentRv >= .5 && currentRv < .6 && finite_db5cca(market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2.5;
    // P4.E3 replaces the broader E2 protection with the narrower boundary
    // that preserves most profitable trades while retaining its loss filter.
    const bullSr02LowRvTrend = includeP4E2Protection && market.regime === 'BULL' && market.slowSubregime === 'SR02' && currentVix < 17 && currentAdx >= 35 && currentRv < .3;
    if (extended || bullPe21 || extendedSr02)
        return 'P4_E234_STRESS_STATE';
    if (weakeningCompact)
        return 'P4_COMPACT_WEAKENING_STATE';
    if (bullSr02LowRvTrend)
        return 'P4_E3_BULL_SR02_LOW_RV_TREND';
    if (bullSr01TrendExtension)
        return 'P4_E222_TREND_EXTENSION';
    if (market.regime === 'BULL' && market.slowSubregime === 'SR01' && currentVix < 15 && currentRv < .4 && currentAdx >= 25)
        return 'P4_E277_LOW_RV_TREND';
    return undefined;
}
export function isQqqP4E21FlatMergedCurrentBarReject_db5cca(row: Row): boolean {
    const currentVix = vix_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const currentRv = rv_db5cca(row);
    const extension = finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
    const regime = row.market.regime;
    const slowSubregime = row.market.slowSubregime;
    const bullSr01 = regime === 'BULL' && slowSubregime === 'SR01' && currentAdx < 22 && currentRv >= .4 && currentRv < .6 && extension >= 1.5 && (currentVix >= 19 || (currentVix >= 17 && currentVix < 19 && currentRv >= .45 && extension >= 2));
    const extendedSr02 = regime === 'RISK_ON_EXTENDED' && slowSubregime === 'SR02' && extension >= 1.5 && ((currentVix >= 15 && currentVix < 18 && currentAdx >= 12 && currentAdx < 20 && currentRv >= .4 && currentRv < .5)
        || (currentVix >= 14 && currentVix < 16 && currentAdx >= 30 && currentRv >= .3 && currentRv < .4));
    const sidewaysSr01 = regime === 'SIDEWAYS' && slowSubregime === 'SR01' && currentVix >= 25 && currentAdx < 12 && currentRv >= .6 && extension >= 1.5;
    const bullSr01LowExtension = regime === 'BULL' && slowSubregime === 'SR01' && currentVix >= 14 && currentVix < 19 && currentAdx < 20 && currentRv >= .4 && currentRv < .6 && extension < 1;
    const bullSr02LowVix = regime === 'BULL' && slowSubregime === 'SR02' && currentVix >= 14 && currentVix < 17 && currentAdx >= 15 && currentAdx < 25 && currentRv >= .2 && currentRv < .4 && extension < 1;
    const weakeningSr02 = regime === 'RISK_ON_WEAKENING' && slowSubregime === 'SR02' && currentVix >= 19 && currentAdx >= 25 && currentRv >= .3 && currentRv < .6 && extension < 0;
    const sidewaysSr01LowerVix = regime === 'SIDEWAYS' && slowSubregime === 'SR01' && currentAdx < 12 && extension >= 1.5 && ((currentVix >= 25 && currentRv >= .6) || (currentVix >= 22 && currentVix < 25 && currentRv >= .6 && currentRv < .8));
    const bullSr02Positive = regime === 'BULL' && slowSubregime === 'SR02' && currentVix >= 14 && currentVix < 17 && ((currentAdx >= 10 && currentAdx < 20 && currentRv >= .3 && currentRv < .4 && extension >= 1 && extension < 2)
        || (currentAdx >= 20 && currentAdx < 35 && currentRv >= .3 && currentRv < .45 && extension < 0)
        || (currentAdx < 15 && currentRv >= .4 && currentRv < .5 && extension >= .5 && extension < 1.5)
        || (currentAdx >= 30 && currentAdx < 40 && currentRv >= .3 && currentRv < .45 && extension >= .5 && extension < 2));
    const weakeningSr02Negative = regime === 'RISK_ON_WEAKENING' && slowSubregime === 'SR02' && currentVix >= 16 && currentVix < 19 && currentAdx >= 10 && currentAdx < 20 && currentRv >= .4 && currentRv < .6 && extension < 0;
    const bullSr01Positive = regime === 'BULL' && slowSubregime === 'SR01' && currentVix >= 14 && currentVix < 17 && currentAdx >= 30 && currentAdx < 35 && currentRv >= .35 && currentRv < .45 && extension >= .5 && extension < 1;
    const sidewaysSr01HighVix = regime === 'SIDEWAYS' && slowSubregime === 'SR01' && currentVix >= 30 && currentAdx < 10 && currentRv >= .8 && extension >= 0;
    return bullSr01 || extendedSr02 || sidewaysSr01 || bullSr01LowExtension || bullSr02LowVix
        || weakeningSr02 || sidewaysSr01LowerVix || bullSr02Positive || weakeningSr02Negative
        || bullSr01Positive || sidewaysSr01HighVix;
}
export function isQqqP4E22CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 17 && vix_db5cca(row) < 20 && adx_db5cca(row) >= 15 && adx_db5cca(row) < 30 && rv_db5cca(row) >= .3 && rv_db5cca(row) < .6 && finite_db5cca(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}
export function isQqqP4E23CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'CURRENT' && vix_db5cca(row) >= 25 && adx_db5cca(row) < 10 && rv_db5cca(row) >= .7;
}
export function isQqqP4E24CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR01' && vix_db5cca(row) >= 24 && vix_db5cca(row) < 26 && adx_db5cca(row) >= 10 && adx_db5cca(row) < 18 && rv_db5cca(row) >= .5 && rv_db5cca(row) < .7 && finite_db5cca(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}
export function isQqqP4E25CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && vix_db5cca(row) >= 16 && vix_db5cca(row) < 19 && adx_db5cca(row) >= 15 && adx_db5cca(row) < 20 && rv_db5cca(row) >= .45 && rv_db5cca(row) < .6 && finite_db5cca(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}
export function isQqqP4E26CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && vix_db5cca(row) >= 16 && vix_db5cca(row) < 17 && adx_db5cca(row) >= 40 && adx_db5cca(row) < 45 && rv_db5cca(row) >= .9 && rv_db5cca(row) < 1.1 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 0;
}
export function isQqqP4E27CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR01' && vix_db5cca(row) >= 18 && vix_db5cca(row) < 18.5 && adx_db5cca(row) >= 10 && adx_db5cca(row) < 15 && rv_db5cca(row) >= .3 && rv_db5cca(row) < .4 && finite_db5cca(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}
export function isQqqP4E28CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'CURRENT' && vix_db5cca(row) >= 19 && vix_db5cca(row) < 21 && adx_db5cca(row) >= 25 && adx_db5cca(row) < 35 && rv_db5cca(row) >= .3 && rv_db5cca(row) < .4 && finite_db5cca(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}
export function isQqqP4E29CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && vix_db5cca(row) >= 21 && vix_db5cca(row) < 22 && adx_db5cca(row) >= 15 && adx_db5cca(row) < 22 && rv_db5cca(row) >= .5 && rv_db5cca(row) < .7 && finite_db5cca(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}
export function isQqqP4E30CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && vix_db5cca(row) >= 18 && vix_db5cca(row) < 19 && adx_db5cca(row) >= 30 && adx_db5cca(row) < 40 && rv_db5cca(row) >= .3 && rv_db5cca(row) < .4 && finite_db5cca(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}
export function isQqqP4E31CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 15 && vix_db5cca(row) < 16 && adx_db5cca(row) >= 10 && adx_db5cca(row) < 15 && rv_db5cca(row) >= .3 && rv_db5cca(row) < .45 && finite_db5cca(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}
export function isQqqP4E32CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 18 && vix_db5cca(row) < 19 && adx_db5cca(row) >= 15 && adx_db5cca(row) < 22 && rv_db5cca(row) >= .3 && rv_db5cca(row) < .4 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 1.5 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 2;
}
export function isQqqP4E33CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR01' && vix_db5cca(row) >= 14 && vix_db5cca(row) < 16 && adx_db5cca(row) >= 18 && adx_db5cca(row) < 21 && rv_db5cca(row) >= .3 && rv_db5cca(row) < .35 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 2.5;
}
export function isQqqP4E34CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 18 && vix_db5cca(row) < 18.5 && adx_db5cca(row) >= 16 && adx_db5cca(row) < 21 && rv_db5cca(row) >= .3 && rv_db5cca(row) < .45 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= .5 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 1;
}
export function isQqqP4E35CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'CURRENT' && vix_db5cca(row) >= 16 && vix_db5cca(row) < 17 && adx_db5cca(row) >= 10 && adx_db5cca(row) < 15 && rv_db5cca(row) >= .3 && rv_db5cca(row) < .45 && finite_db5cca(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}
export function isQqqP4E36CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 18 && vix_db5cca(row) < 19 && adx_db5cca(row) >= 30 && adx_db5cca(row) < 40 && rv_db5cca(row) >= .3 && rv_db5cca(row) < .4 && finite_db5cca(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}
export function isQqqP4E37CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 19 && vix_db5cca(row) < 20 && adx_db5cca(row) >= 15 && adx_db5cca(row) < 20 && rv_db5cca(row) >= .8 && rv_db5cca(row) < 1 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= .5 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 1;
}
export function isQqqP4E38CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR01' && vix_db5cca(row) >= 13 && vix_db5cca(row) < 14 && adx_db5cca(row) >= 15 && adx_db5cca(row) < 16 && rv_db5cca(row) >= .4 && rv_db5cca(row) < .45 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 0 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < .3;
}
export function isQqqP4E39CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 14 && vix_db5cca(row) < 15 && adx_db5cca(row) >= 30 && adx_db5cca(row) < 40 && rv_db5cca(row) >= .4 && rv_db5cca(row) < .5 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2;
}
export function isQqqP4E40CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && vix_db5cca(row) >= 14 && vix_db5cca(row) < 15 && adx_db5cca(row) >= 0 && adx_db5cca(row) < 12 && rv_db5cca(row) >= .3 && rv_db5cca(row) < .45 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 1 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 1.5;
}
export function isQqqP4E41CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 15 && vix_db5cca(row) < 16 && adx_db5cca(row) >= 20 && adx_db5cca(row) < 25 && rv_db5cca(row) >= .5 && rv_db5cca(row) < .6 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 0 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < .5;
}
export function isQqqP4E42CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 14 && vix_db5cca(row) < 15 && adx_db5cca(row) >= 12 && adx_db5cca(row) < 15 && rv_db5cca(row) >= .4 && rv_db5cca(row) < .5 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 0 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < .5;
}
export function isQqqP4E43CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 14 && vix_db5cca(row) < 15 && adx_db5cca(row) >= 18 && adx_db5cca(row) < 20 && rv_db5cca(row) >= .4 && rv_db5cca(row) < .5 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2;
}
export function isQqqP4E44CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 14 && vix_db5cca(row) < 15 && adx_db5cca(row) >= 24 && adx_db5cca(row) < 27 && rv_db5cca(row) >= .2 && rv_db5cca(row) < .3 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 0;
}
export function isQqqP4E45CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 16 && vix_db5cca(row) < 17 && adx_db5cca(row) >= 30 && adx_db5cca(row) < 32 && rv_db5cca(row) >= .35 && rv_db5cca(row) < .45 && finite_db5cca(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}
export function isQqqP4E46CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 22 && vix_db5cca(row) < 23 && adx_db5cca(row) >= 28 && adx_db5cca(row) < 30 && rv_db5cca(row) >= .6 && rv_db5cca(row) < .7 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 1.5 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 2.2;
}
export function isQqqP4E47CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 18 && vix_db5cca(row) < 19 && adx_db5cca(row) >= 16 && adx_db5cca(row) < 18 && rv_db5cca(row) >= .35 && rv_db5cca(row) < .45 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < -1;
}
export function isQqqP4E48CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 22 && vix_db5cca(row) < 23 && adx_db5cca(row) >= 15 && adx_db5cca(row) < 16 && rv_db5cca(row) >= .5 && rv_db5cca(row) < .6 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= -1.3 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < -.8;
}
export function isQqqP4E49CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 16 && vix_db5cca(row) < 17 && adx_db5cca(row) >= 15 && adx_db5cca(row) < 17 && rv_db5cca(row) >= .5 && rv_db5cca(row) < .6 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= .5 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 1;
}
export function isQqqP4E53CurrentBarReject_db5cca(row: Row): boolean {
    return row.market.slowSubregime === 'SR01' && finite_db5cca(row.market.vix, Number.NEGATIVE_INFINITY) >= 33 && adx_db5cca(row) >= 10 && adx_db5cca(row) < 20;
}
const qqqP4E54FlatRejectors_db5cca: Array<(row: Row) => boolean> = [
    isQqqP4E21FlatMergedCurrentBarReject_db5cca,
    isQqqP4E22CurrentBarReject_db5cca,
    isQqqP4E23CurrentBarReject_db5cca,
    isQqqP4E24CurrentBarReject_db5cca,
    isQqqP4E25CurrentBarReject_db5cca,
    isQqqP4E26CurrentBarReject_db5cca,
    isQqqP4E27CurrentBarReject_db5cca,
    isQqqP4E28CurrentBarReject_db5cca,
    isQqqP4E29CurrentBarReject_db5cca,
    isQqqP4E30CurrentBarReject_db5cca,
    isQqqP4E31CurrentBarReject_db5cca,
    isQqqP4E32CurrentBarReject_db5cca,
    isQqqP4E33CurrentBarReject_db5cca,
    isQqqP4E34CurrentBarReject_db5cca,
    isQqqP4E35CurrentBarReject_db5cca,
    isQqqP4E36CurrentBarReject_db5cca,
    isQqqP4E37CurrentBarReject_db5cca,
    isQqqP4E38CurrentBarReject_db5cca,
    isQqqP4E39CurrentBarReject_db5cca,
    isQqqP4E40CurrentBarReject_db5cca,
    isQqqP4E41CurrentBarReject_db5cca,
    isQqqP4E42CurrentBarReject_db5cca,
    isQqqP4E43CurrentBarReject_db5cca,
    isQqqP4E44CurrentBarReject_db5cca,
    isQqqP4E45CurrentBarReject_db5cca,
    isQqqP4E46CurrentBarReject_db5cca,
    isQqqP4E47CurrentBarReject_db5cca,
    isQqqP4E48CurrentBarReject_db5cca,
    isQqqP4E49CurrentBarReject_db5cca,
    isQqqP4E53CurrentBarReject_db5cca,
];
function isQqqP4E54FlatMergedCurrentBarReject_db5cca(row: Row): boolean {
    return qqqP4E54FlatRejectors_db5cca.some((reject) => reject(row));
}
function isQqqP4E56RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentVix = vix_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const currentRv = rv_db5cca(row);
    const extension = finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
    const bullSr01 = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && currentVix >= 21 && currentAdx < 22 && currentRv >= .4 && currentRv < .6 && extension >= 1.5;
    const bullSr02LowAdx = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentAdx < 18 && ((currentVix >= 14 && currentVix < 17 && currentAdx >= 10 && currentAdx < 20 && currentRv >= .3 && currentRv < .4 && extension >= 1 && extension < 2)
        || (currentVix >= 17 && currentVix < 20 && currentAdx >= 15 && currentAdx < 30 && currentRv >= .3 && currentRv < .6 && extension < 0));
    const weakeningSr02LowVix = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && currentVix < 17.5 && currentVix >= 16 && currentAdx >= 10 && currentAdx < 20 && currentRv >= .4 && currentRv < .6 && extension < 0;
    return bullSr01 || bullSr02LowAdx || weakeningSr02LowVix;
}
function isQqqP4E57RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentVix = vix_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const currentRv = rv_db5cca(row);
    const extension = finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
    const bullSr01 = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && currentVix < 19 && currentVix >= 15 && currentAdx < 20 && currentRv >= .4 && currentRv < .5 && extension < 1 && extension >= 0;
    const bullSr02E11 = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentVix >= 14 && currentVix < 17 && currentAdx < 25 && currentRv >= .2 && currentRv < .4 && extension < 1 && currentAdx >= 22;
    const bullSr02E15 = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentVix < 17 && currentAdx >= 20 && currentAdx < 35 && currentRv >= .3 && currentRv < .45 && extension < 0 && currentVix >= 15.5 && extension > -.6;
    const bullSr02E20 = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentVix < 17 && currentAdx >= 30 && currentAdx < 40 && currentRv >= .3 && currentRv < .45 && extension >= .5 && extension < 2 && currentVix >= 15;
    return bullSr01 || bullSr02E11 || bullSr02E15 || bullSr02E20;
}
function isQqqP4E58RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentVix = vix_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const extension = finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
    const bullSr01 = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && currentVix < 19 && currentVix >= 17.5 && currentAdx < 20 && rv_db5cca(row) >= .4 && rv_db5cca(row) < .6 && extension < 1 && extension >= 0;
    const bullSr02E11 = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentVix < 17 && currentAdx < 25 && rv_db5cca(row) >= .2 && rv_db5cca(row) < .4 && extension < 1 && currentVix >= 15.5 && currentAdx >= 19;
    const extendedSr02 = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && currentVix >= 17 && currentVix < 18 && currentAdx >= 12 && currentAdx < 20 && rv_db5cca(row) >= .4 && rv_db5cca(row) < .5 && extension >= 1.5;
    const weakeningSr02 = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && currentVix >= 22 && currentAdx >= 25 && rv_db5cca(row) >= .3 && rv_db5cca(row) < .6 && extension < 0;
    const sidewaysHighVix = row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && currentVix >= 30 && currentAdx < 10 && rv_db5cca(row) >= .8 && extension >= .3 && extension < 0.5;
    const weakeningSr01 = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && currentVix < 19 && currentVix >= 18.4 && currentAdx >= 15 && currentAdx < 20 && rv_db5cca(row) >= .45 && rv_db5cca(row) < .6 && extension < 0;
    const weakeningSr01Tail = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && currentVix >= 21 && currentVix < 22 && currentAdx >= 15 && currentAdx < 22 && rv_db5cca(row) >= .5 && rv_db5cca(row) < .7 && extension < -1;
    const rangeSr02 = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && currentVix >= 18 && currentAdx >= 16 && currentAdx < 21 && rv_db5cca(row) >= .3 && rv_db5cca(row) < .45 && extension >= .5 && extension < 1 && currentVix < 18.2;
    return bullSr01 || bullSr02E11 || extendedSr02 || weakeningSr02 || sidewaysHighVix || weakeningSr01 || weakeningSr01Tail || rangeSr02;
}
function isQqqP4E59RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentVix = vix_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const currentRv = rv_db5cca(row);
    const extension = finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
    const bullSr01 = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && currentVix < 19 && currentVix >= 17.25 && currentAdx < 20 && currentRv >= .4 && currentRv < .6 && extension < 1 && extension >= 0;
    const bullSr02LowAdx = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentVix < 17 && currentAdx >= 15 && currentAdx < 25 && currentRv >= .2 && currentRv < .4 && extension < 1 && currentVix >= 15;
    const weakeningSr02Vix = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && currentAdx >= 25 && currentRv >= .3 && currentRv < .6 && extension < 0 && currentVix >= 20.5;
    const weakeningSr02Tail = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && currentVix < 19 && currentAdx >= 10 && currentAdx < 20 && currentRv >= .4 && currentRv < .6 && currentVix >= 18 && extension < -1.5;
    const bullSr02HighAdx = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentVix < 17 && currentAdx >= 30 && currentAdx < 40 && currentRv >= .3 && currentRv < .45 && extension >= .5 && extension < 2 && currentVix >= 14.3;
    const bullSr02MidVix = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentVix < 20 && currentAdx >= 15 && currentRv >= .3 && currentRv < .6 && extension < 0 && currentVix >= 17.5 && currentAdx < 25 && extension > -.35;
    return bullSr01 || bullSr02LowAdx || weakeningSr02Vix || weakeningSr02Tail || bullSr02HighAdx || bullSr02MidVix;
}
function isQqqP4E61RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentAdx = adx_db5cca(row);
    const extension = finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentAdx >= 10 && currentAdx < 30 && extension >= 1 && extension < 1.5;
}
function isQqqP4E62RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentAdx = adx_db5cca(row);
    const currentRv = rv_db5cca(row);
    const extension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const weakeningSr02 = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && currentAdx >= 15 && currentAdx < 25 && currentRv < .5;
    const sidewaysSr01 = row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && currentRv >= .7 && currentRv < .8 && extension < 2;
    return weakeningSr02 || sidewaysSr01;
}
function isQqqP4E63RecoveryCurrentBar_db5cca(row: Row): boolean {
    const extension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    return row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && extension >= -2.3 && extension < -1.5;
}
function isQqqP4E65RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentVix = finite_db5cca(row.market.vix, Number.NaN);
    const currentAdx = adx_db5cca(row);
    const currentRv = rv_db5cca(row);
    const extension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const weakeningSr01 = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && currentRv >= .4 && extension >= -1 && extension < -.5;
    const bullSr01 = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && currentRv >= .4 && extension >= -.5 && extension < 0;
    const bullSr02 = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentAdx >= 10 && currentAdx < 15 && extension >= .5;
    const sidewaysSr01 = row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && currentVix >= 30 && extension >= 2;
    return weakeningSr01 || bullSr01 || bullSr02 || sidewaysSr01;
}
function isQqqP4E66RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRoc20 = finite_db5cca(row.market.roc20, Number.NaN);
    const currentRsi14 = finite_db5cca(row.market.rsi14, Number.NaN);
    return row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && currentRoc20 >= .05 && currentRsi14 < 70;
}
function isQqqP4E67RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentRsi14 = finite_db5cca(row.market.rsi14, Number.NaN);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.NaN);
    const currentRv20 = rv_db5cca(row);
    const selectedLower = lower_db5cca(row);
    const bullMomentum = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentExtension >= -1 && currentExtension < -.5 && (currentRsi14 >= 50 || currentRoc5 >= 0);
    const extendedRvLower = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && currentRv20 >= .3 && currentRv20 < .4 && selectedLower >= .45;
    return bullMomentum || extendedRvLower;
}
function isQqqP4E68RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentVix = vix_db5cca(row);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const selectedLower = lower_db5cca(row);
    return row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && currentVix < 18 && selectedLower >= .4 && selectedLower < .45 && currentExtension < -.3;
}
export function isQqqP4E68MergedCurrentBarReject_db5cca(row: Row): boolean {
    return memoValue(row, 'isQqqP4E68MergedCurrentBarReject_db5cca', () => isQqqP4E68MergedCurrentBarReject_db5ccaImpl(row));
}
function isQqqP4E68MergedCurrentBarReject_db5ccaImpl(row: Row): boolean { return isQqqP4E54FlatMergedCurrentBarReject_db5cca(row) && ![isQqqP4E56RecoveryCurrentBar_db5cca, isQqqP4E57RecoveryCurrentBar_db5cca, isQqqP4E58RecoveryCurrentBar_db5cca, isQqqP4E59RecoveryCurrentBar_db5cca, isQqqP4E61RecoveryCurrentBar_db5cca, isQqqP4E62RecoveryCurrentBar_db5cca, isQqqP4E63RecoveryCurrentBar_db5cca, isQqqP4E65RecoveryCurrentBar_db5cca, isQqqP4E66RecoveryCurrentBar_db5cca, isQqqP4E67RecoveryCurrentBar_db5cca, isQqqP4E68RecoveryCurrentBar_db5cca].some(test => test(row)); }
export function isQqqP4E72RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentAdx = adx_db5cca(row);
    const currentRv20 = rv_db5cca(row);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentRsi14 = finite_db5cca(row.market.rsi14, Number.NaN);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.NaN);
    const trendPocket = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && currentAdx >= 40 && currentRv20 < .4 && currentExtension >= 1.5;
    return trendPocket && ((currentRsi14 < 72 && currentRoc5 >= .0035)
        || (currentRsi14 < 80 && currentRoc5 >= .03));
}
function leaf_isQqqP4E87RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentVix = vix_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const currentRv20 = rv_db5cca(row);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.NaN);
    const expandedBullContinuation = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentVix < 16 && currentAdx >= 20 && currentAdx < 30 && currentRv20 < .5 && currentExtension >= -.5 && currentExtension < .5 && ((currentExtension >= 0 && currentRoc5 >= 0) || (currentExtension < 0 && currentRoc5 >= .015));
    // The ADX<30 branch subsumes E85's ADX<25 branch, so keep only the E72
    // parent plus this single expanded predicate in the canonical builder.
    return expandedBullContinuation;
}
function leaf_isQqqP4E102RecoveryCurrentBar_db5cca(row: Row): boolean {
    const broadQualityBull = row.market.regime === 'BULL' && (row.market.slowSubregime === 'CURRENT' || row.market.slowSubregime === 'SR01' || row.market.slowSubregime === 'SR02') && vix_db5cca(row) < 16 && adx_db5cca(row) >= 20 && adx_db5cca(row) < 30 && rv_db5cca(row) < .67 && finite_db5cca(row.market.roc5, Number.NEGATIVE_INFINITY) >= .015;
    return broadQualityBull;
}
function leaf_isQqqP4E103RecoveryCurrentBar_db5cca(row: Row): boolean {
    const broadQualityBull = row.market.regime === 'BULL' && ['CURRENT', 'SR01', 'SR02'].includes(row.market.slowSubregime ?? '') && vix_db5cca(row) < 16 && adx_db5cca(row) >= 18 && adx_db5cca(row) < 30 && rv_db5cca(row) < .67 && finite_db5cca(row.market.roc5, Number.NEGATIVE_INFINITY) >= .015;
    return broadQualityBull;
}
function isQqqP4E103RecoveryCurrentBar_db5cca(row: Row): boolean { return [isQqqP4E72RecoveryCurrentBar_db5cca, leaf_isQqqP4E87RecoveryCurrentBar_db5cca, leaf_isQqqP4E102RecoveryCurrentBar_db5cca, leaf_isQqqP4E103RecoveryCurrentBar_db5cca].some(test => test(row)); }
function isQqqP4E104RecoveryCurrentBar_db5cca(row: Row): boolean {
    return memoValue(row, 'isQqqP4E104RecoveryCurrentBar_db5cca', () => isQqqP4E104RecoveryCurrentBar_db5ccaImpl(row));
}
function isQqqP4E104RecoveryCurrentBar_db5ccaImpl(row: Row): boolean {
    const broadQualityBull = row.market.regime === 'BULL' && ['CURRENT', 'SR01', 'SR02'].includes(row.market.slowSubregime ?? '') && vix_db5cca(row) < 16 && rv_db5cca(row) < .67 && ((adx_db5cca(row) >= 17 && adx_db5cca(row) < 30 && finite_db5cca(row.market.roc5, Number.NEGATIVE_INFINITY) >= .015)
        || (adx_db5cca(row) >= 30 && adx_db5cca(row) < 35 && finite_db5cca(row.market.roc5, Number.NEGATIVE_INFINITY) >= .02));
    return isQqqP4E103RecoveryCurrentBar_db5cca(row) || broadQualityBull;
}
const f_6b1c48 = (value: number | null | undefined) => Number.isFinite(value) ? value as number : Number.NaN;
const p6e84BullQualityVeto_77cca6 = (row: Row) => row.market.slowSubregime === 'SR01' && row.market.regime === 'BULL' && f_6b1c48(row.market.adx14) < 15 && f_6b1c48(row.market.roc20) < 0 && f_6b1c48(row.market.tqqqRealisedVol20d) >= .43 && f_6b1c48(row.market.tqqqRealisedVol20d) < .60;
const e369RangeSr01NegativeRoc_8e756a = (row: Row) => row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR01' && Number.isFinite(row.market.roc5) && f_6b1c48(row.market.roc5) < 0;
const p6e369RangePressureReject_8e756a = (row: Row) => {
    if (!e369RangeSr01NegativeRoc_8e756a(row) || !Number.isFinite(row.market.vix))
        return false;
    const vix = f_6b1c48(row.market.vix), extension = f_6b1c48(row.market.priceExtensionAtr), term = f_6b1c48(row.market.vixTermStructureSlope);
    if (vix >= 26)
        return true;
    if (vix < 20.75)
        return false;
    if (vix < 22.5)
        return !Number.isFinite(extension) || (extension >= 0 && (!Number.isFinite(term) || term < 1));
    return !Number.isFinite(extension) || !Number.isFinite(term) || extension >= .5 || term < 1;
};
const p6e122PositiveGuard_61d9dc = (row: Row) => f_6b1c48(row.market.tqqqRealisedVol20d) >= .95 && f_6b1c48(row.market.roc20) >= .04 && f_6b1c48(row.market.range20dPct) >= .13;
const p6e222RangeFloor_d0e51b = .15;
const p6e369Reject_8e756a = (row: Row) => (isQqqP4E68MergedCurrentBarReject_db5cca(row) && !isQqqP4E104RecoveryCurrentBar_db5cca(row))
    || p6e84BullQualityVeto_77cca6(row)
    || p6e369RangePressureReject_8e756a(row)
    || (p6e122PositiveGuard_61d9dc(row) && f_6b1c48(row.market.vixTermStructureSlope) >= 3)
    || (f_6b1c48(row.market.roc5) < 0 && f_6b1c48(row.market.range20dPct) >= p6e222RangeFloor_d0e51b && f_6b1c48(row.market.vix) <= 22.25);
const stateIs_5585cd = (row: Row, regime: string, slow: string) => row.market.regime === regime && row.market.slowSubregime === slow;
const p5e213E65Grouped_5585cd = (row: Row) => {
    const adx = f_6b1c48(row.market.adx14);
    const roc5 = f_6b1c48(row.market.roc5);
    const roc20 = f_6b1c48(row.market.roc20);
    const vix = f_6b1c48(row.market.vix);
    const extension = f_6b1c48(row.market.priceExtensionAtr);
    const range20 = f_6b1c48(row.market.range20dPct);
    const vixChange = f_6b1c48(row.market.vixChange5d);
    const rv20 = f_6b1c48(row.market.tqqqRealisedVol20d);
    const termSlope = f_6b1c48(row.market.vixTermStructureSlope);
    const distance = f_6b1c48(row.market.distanceToSma20Pct);
    const rsi = f_6b1c48(row.market.rsi14);
    const slope20 = f_6b1c48(row.market.sma20SlopePct);
    const ma50Slope = f_6b1c48(row.market.ma50SlopePct);
    const drawdown = f_6b1c48(row.market.drawdownFromRecentHighPct);
    if (stateIs_5585cd(row, 'RISK_ON_EXTENDED', 'SR02'))
        return (adx < 30 && roc5 < .0044 && vix < 17) || (vix < 12 && roc5 < .01 && adx >= 25) || (adx >= 40 && drawdown >= .01 && vix < 15) || (extension < 2.5 && roc5 >= .018 && rv20 < .3);
    if (stateIs_5585cd(row, 'BULL', 'SR02'))
        return (extension < 1 && rsi >= 60 && (adx >= 20 || range20 >= .06)) || (adx >= 25 && extension < 0);
    if (stateIs_5585cd(row, 'RANGE_BOUND', 'SR01'))
        return (roc20 >= -.02 && slope20 < 0 && vix < 17) || (adx < 15 && range20 >= .06) || (roc5 >= .01 && roc20 < 0) || (adx < 15 && rv20 >= .5);
    if (stateIs_5585cd(row, 'SIDEWAYS', 'SR01'))
        return (roc20 >= .02 && ((termSlope < 2.5 && distance < .05) || (extension < 1.5 && vixChange < 0))) || (vixChange >= 0 && ((roc20 >= -.05 && termSlope < 1) || (extension < 0 && distance >= -.02))) || (rv20 >= .67 && range20 < .12 && ma50Slope < .02) || (adx < 20 && roc5 >= .01 && distance < .05) || (vix >= 16 && rv20 < .5) || (adx < 15 && termSlope < 3);
    if (stateIs_5585cd(row, 'RISK_ON_EXTENDED', 'SR01'))
        return vix < 15 && extension >= 3 && adx < 35;
    if (stateIs_5585cd(row, 'RANGE_BOUND', 'SR02'))
        return (adx >= 15 && ((slope20 < 0 && vixChange < .05) || (roc5 >= 0 && drawdown >= .01))) || (roc20 < 0 && vixChange >= .05 && rsi >= 50) || (extension >= 2 && roc20 >= .02);
    if (stateIs_5585cd(row, 'RISK_ON_EXTENDED', 'CURRENT'))
        return true;
    if (stateIs_5585cd(row, 'BULL', 'SR01'))
        return vix < 14 && extension >= 0;
    if (stateIs_5585cd(row, 'RISK_ON_WEAKENING', 'SR02'))
        return roc5 < 0 && rsi >= 50;
    if (stateIs_5585cd(row, 'RISK_ON_WEAKENING', 'SR01'))
        return adx >= 25 && vixChange < 0;
    if (stateIs_5585cd(row, 'RISK_ON_WEAKENING', 'CURRENT') || stateIs_5585cd(row, 'SIDEWAYS', 'SR02'))
        return range20 >= .06 && slope20 < 0;
    if (stateIs_5585cd(row, 'BULL', 'CURRENT'))
        return adx >= 15;
    return false;
};
const p6e220E65Grouped_bd991b = (row: Row) => {
    if (row.market.regime !== 'RANGE_BOUND' || row.market.slowSubregime !== 'SR01')
        return p5e213E65Grouped_5585cd(row);
    const roc20 = f_6b1c48(row.market.roc20);
    const slope20 = f_6b1c48(row.market.sma20SlopePct);
    const vix = f_6b1c48(row.market.vix);
    const adx = f_6b1c48(row.market.adx14);
    const range20 = f_6b1c48(row.market.range20dPct);
    const roc5 = f_6b1c48(row.market.roc5);
    return (roc20 >= -.02 && slope20 < 0 && vix < 17)
        || (adx < 15 && range20 >= .06)
        || (roc5 >= .01 && roc20 < 0);
};
const previous_5585cd = (row: Row) => row.history.length >= 2 ? row.history[row.history.length - 2] : undefined;
const p5e213E68Grouped_5585cd = (row: Row) => {
    const prev = previous_5585cd(row);
    if (stateIs_5585cd(row, 'RISK_ON_EXTENDED', 'SR02'))
        return (prev?.regime === 'BULL' && prev?.slowSubregime === 'SR01') || (prev?.regime === 'BULL' && prev?.slowSubregime === 'SR02' && f_6b1c48(row.market.adx14) < 12) || (prev?.regime === 'RISK_ON_EXTENDED' && prev?.slowSubregime === 'CURRENT' && f_6b1c48(row.market.vix) < 14);
    if (stateIs_5585cd(row, 'RANGE_BOUND', 'SR02'))
        return prev?.regime === 'RANGE_BOUND' && prev?.slowSubregime === 'SR01' && f_6b1c48(row.market.adx14) < 12;
    return false;
};
const sequence_5585cd = (row: Row) => memoValue(row, 'last-three', () => lastThreeStateSequence(row.history, row.market));
const p5e213E71_5585cd = (row: Row) => sequence_5585cd(row) === 'RISK_ON_EXTENDED/CURRENT -> RISK_ON_EXTENDED/SR02 -> RISK_ON_EXTENDED/SR02'
    || sequence_5585cd(row) === 'RANGE_BOUND/SR01 -> RANGE_BOUND/SR01 -> RISK_ON_WEAKENING/SR01';
const p5e213E74Grouped_5585cd = (row: Row) => {
    const seq = sequence_5585cd(row);
    const adx12 = f_6b1c48(row.market.adx14) < 12;
    const vixChangeUp = f_6b1c48(row.market.vixChange5d) >= 0;
    if (seq === 'RANGE_BOUND/SR02 -> BULL/SR02 -> RANGE_BOUND/SR02')
        return f_6b1c48(row.market.rsi14) >= 50 || adx12;
    if (seq === 'BULL/SR01 -> BULL/SR01 -> BULL/SR02')
        return vixChangeUp;
    if (seq === 'BULL/SR01 -> BULL/SR01 -> RISK_ON_EXTENDED/SR01')
        return f_6b1c48(row.market.tqqqRealisedVol20d) >= .5;
    if (seq === 'BULL/SR02 -> RISK_ON_EXTENDED/SR02 -> RISK_ON_EXTENDED/SR02')
        return f_6b1c48(row.market.roc5) < 0;
    if (seq === 'BULL/SR02 -> RISK_ON_EXTENDED/SR02 -> BULL/SR02' || seq === 'RISK_ON_WEAKENING/SR02 -> RISK_ON_WEAKENING/SR02 -> BULL/SR02')
        return adx12;
    if (seq === 'RANGE_BOUND/SR02 -> BULL/SR02 -> BULL/SR02')
        return vixChangeUp;
    return false;
};
const p5e213E77_5585cd = (row: Row) => sequence_5585cd(row) === 'RISK_ON_EXTENDED/SR01 -> RISK_ON_EXTENDED/SR02 -> RISK_ON_EXTENDED/SR02' && f_6b1c48(row.market.vix) < 14;
const sequence_362a33 = (row: Row) => memoValue(row, 'last-three', () => lastThreeStateSequence(row.history, row.market));
const rwSequence_362a33 = 'RISK_ON_WEAKENING/SR02 -> RISK_ON_WEAKENING/SR02 -> RISK_ON_WEAKENING/SR02';
const p5e86RwPocket_362a33 = (row: Row) => sequence_362a33(row) === rwSequence_362a33 && f_6b1c48(row.market.vix) >= 16 && f_6b1c48(row.market.vixTermStructureSlope) < 3;
const p5e213E86_5585cd = p5e86RwPocket_362a33;
const p5e213E87Grouped_5585cd = (row: Row) => {
    const seq = sequence_5585cd(row);
    const transition = seq === 'RISK_ON_EXTENDED/SR02 -> BULL/SR02 -> BULL/SR02' || seq === 'BULL/SR02 -> BULL/SR02 -> RANGE_BOUND/SR02';
    return (seq === 'BULL/SR02 -> BULL/SR02 -> RISK_ON_EXTENDED/SR02' && f_6b1c48(row.market.priceExtensionAtr) >= 2 && f_6b1c48(row.market.vixChange5d) < 0)
        || (transition && f_6b1c48(row.market.adx14) < 12 && f_6b1c48(row.market.vix) < 14);
};
const extPocket_8dbc6d = (row: Row) => row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.vix) >= 18 && f_6b1c48(row.market.priceExtensionAtr) >= 2 && f_6b1c48(row.market.vixChange5d) >= 0;
const sequence_8dbc6d = (row: Row) => memoValue(row, 'last-three', () => lastThreeStateSequence(row.history, row.market));
const crisisWeakSequence_8dbc6d = 'CRISIS/SR02 -> RISK_ON_WEAKENING/SR01 -> RISK_ON_WEAKENING/SR01';
const crisisPocket_8dbc6d = (row: Row) => sequence_8dbc6d(row) === crisisWeakSequence_8dbc6d;
const rangePocket_8dbc6d = (row: Row) => row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.adx14) < 12 && f_6b1c48(row.market.tqqqRealisedVol20d) < .5 && f_6b1c48(row.market.range20dPct) >= .06;
const p5e94Pockets_8dbc6d = { extPocket: extPocket_8dbc6d, crisisPocket: crisisPocket_8dbc6d, rangePocket: rangePocket_8dbc6d };
const p5e213E94_5585cd = (row: Row) => p5e94Pockets_8dbc6d.extPocket(row) || p5e94Pockets_8dbc6d.crisisPocket(row) || p5e94Pockets_8dbc6d.rangePocket(row);
const p6e220Admission_bd991b = (row: Row) => p6e220E65Grouped_bd991b(row)
    || p5e213E68Grouped_5585cd(row)
    || p5e213E71_5585cd(row)
    || p5e213E74Grouped_5585cd(row)
    || p5e213E77_5585cd(row)
    || p5e213E86_5585cd(row)
    || p5e213E87Grouped_5585cd(row)
    || p5e213E94_5585cd(row);
function currentAdxBelow_db5cca(row: Row, ceiling: number): boolean {
    return adx_db5cca(row) < ceiling;
}
function leaf_isQqqP4E109RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentVix = vix_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const currentRv = rv_db5cca(row);
    const currentRoc = finite_db5cca(row.market.roc5, Number.NEGATIVE_INFINITY);
    const extendedSr02 = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && ((currentVix >= 12 && currentVix < 14 && currentRv >= .5 && currentRv < .6)
        || (currentAdx >= 20 && currentAdx < 25 && currentRoc >= .02 && currentRoc < .03));
    const rangeBound = row.market.regime === 'RANGE_BOUND' && ((row.market.slowSubregime === 'SR01' && currentAdx >= 18 && currentAdx < 20)
        || (row.market.slowSubregime === 'SR02' && currentVix >= 12 && currentVix < 14 && currentRv < .3));
    const bullSr02 = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && ((currentVix < 12 && currentRv < .3)
        || (currentAdx >= 30 && currentAdx < 35 && currentRv >= .4 && currentRv < .5));
    return extendedSr02 || rangeBound || bullSr02;
}
function leaf_isQqqP4E112RecoveryCurrentBar_db5cca(row: Row): boolean {
    const extVixRvExtension = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 12 && vix_db5cca(row) < 15 && rv_db5cca(row) >= .5 && rv_db5cca(row) < .6;
    return extVixRvExtension;
}
function leaf_isQqqP4E114RecoveryCurrentBar_db5cca(row: Row): boolean {
    const extendedAdxSlice = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && adx_db5cca(row) >= 25 && adx_db5cca(row) < 30 && finite_db5cca(row.market.roc5, Number.NEGATIVE_INFINITY) >= .02 && finite_db5cca(row.market.roc5, Number.NEGATIVE_INFINITY) < .03;
    const rangeSr01Slice = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR01' && adx_db5cca(row) >= 17 && adx_db5cca(row) < 18;
    const rangeSr02Slice = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 14 && vix_db5cca(row) < 15 && rv_db5cca(row) < .3;
    return extendedAdxSlice || rangeSr01Slice || rangeSr02Slice;
}
function leaf_isQqqP4E116RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentVix = vix_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const currentRv = rv_db5cca(row);
    const bullLowAdx = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentAdx < 16 && currentRv < .3;
    const rangeSr02LowRv = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && currentVix >= 12 && currentVix < 16 && currentRv < .3;
    const weakeningVix = row.market.regime === 'RISK_ON_WEAKENING' && currentVix >= 12 && currentVix < 14;
    const rangeSr01ModerateRv = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR01' && currentVix >= 14 && currentVix < 16 && currentRv >= .4 && currentRv < .5;
    const weakeningSr02 = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && currentAdx < 12 && currentRv >= .4 && currentRv < .5;
    const extendedSr01 = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR01' && currentVix < 12;
    const bullModerateRv = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentVix < 12 && currentRv >= .4 && currentRv < .5;
    return bullLowAdx || rangeSr02LowRv || weakeningVix || rangeSr01ModerateRv || weakeningSr02 || extendedSr01 || bullModerateRv;
}
function leaf_isQqqP4E120RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentVix = vix_db5cca(row);
    const currentRv = rv_db5cca(row);
    const currentRsi = finite_db5cca(row.market.rsi14, Number.NEGATIVE_INFINITY);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
    const bullLowRv = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentVix < 12 && currentRv >= .3 && currentRv < .4 && currentRsi >= 60 && currentRsi < 65;
    const extendedSr01 = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR01' && currentExtension >= 3 && currentRv >= .3 && currentRv < .4;
    const weakeningSr01 = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && currentRv >= .8 && currentRv < 1;
    return bullLowRv || extendedSr01 || weakeningSr01;
}
function leaf_isQqqP4E124RecoveryCurrentBar_db5cca(row: Row): boolean {
    const weakeningPath = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && rv_db5cca(row) >= .67 && rv_db5cca(row) < .8 && lower_db5cca(row) >= .45 && lower_db5cca(row) < .49 && sigma_db5cca(row) === 2.5;
    return weakeningPath;
}
function leaf_isQqqP4E127RecoveryCurrentBar_db5cca(row: Row): boolean {
    const sidewaysRvRecovery = row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && rv_db5cca(row) >= .5 && rv_db5cca(row) < .6 && !(adx_db5cca(row) < 20 && finite_db5cca(row.market.roc5, Number.POSITIVE_INFINITY) <= -.04);
    return sidewaysRvRecovery;
}
function leaf_isQqqP4E129RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.NaN);
    const sidewaysHighRv = row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && ((currentRv >= .6 && currentRv < .67 && currentAdx >= 20 && currentAdx < 25)
        || (currentRv >= .67 && currentRv < .8 && currentAdx >= 12 && currentAdx < 16)
        || (currentRv >= 1 && currentAdx >= 12 && currentAdx < 16));
    const rangePositiveContinuation = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && currentRv >= .6 && currentRv < .67 && currentRoc5 >= .02 && currentRoc5 < .05;
    return sidewaysHighRv || rangePositiveContinuation;
}
function leaf_isQqqP4E133RecoveryCurrentBar_db5cca(row: Row): boolean {
    const extendedPositive = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && rv_db5cca(row) >= .3 && rv_db5cca(row) < .4 && adx_db5cca(row) >= 20 && adx_db5cca(row) < 25 && finite_db5cca(row.market.roc5, Number.NEGATIVE_INFINITY) >= .01;
    return extendedPositive;
}
function leaf_isQqqP4E137RecoveryCurrentBar_db5cca(row: Row): boolean {
    const previous = row.history.length >= 2 ? row.history[row.history.length - 2] : undefined;
    const bullCurrentTransition = previous?.regime === 'BULL' && previous.slowSubregime === 'CURRENT';
    return bullCurrentTransition;
}
function leaf_isQqqP4E139RecoveryCurrentBar_db5cca(row: Row): boolean {
    const previous = row.history.length >= 2 ? row.history[row.history.length - 2] : undefined;
    const previousState = `${previous?.regime ?? 'NA'}/${previous?.slowSubregime ?? 'NA'}`;
    const currentState = `${row.market.regime ?? 'NA'}/${row.market.slowSubregime ?? 'NA'}`;
    const weakeningToBull = previousState === 'RISK_ON_WEAKENING/SR01' && currentState === 'BULL/SR01' && rv_db5cca(row) >= .6 && rv_db5cca(row) < .67;
    const extendedToBull = previousState === 'RISK_ON_EXTENDED/SR02' && currentState === 'BULL/SR02' && rv_db5cca(row) >= .3 && rv_db5cca(row) < .4 && lower_db5cca(row) >= .35 && lower_db5cca(row) < .4 && sigma_db5cca(row) === 2.5;
    return weakeningToBull || extendedToBull;
}
function isQqqP4E139RecoveryCurrentBar_db5cca(row: Row): boolean { return [isQqqP4E104RecoveryCurrentBar_db5cca, leaf_isQqqP4E109RecoveryCurrentBar_db5cca, leaf_isQqqP4E112RecoveryCurrentBar_db5cca, leaf_isQqqP4E114RecoveryCurrentBar_db5cca, leaf_isQqqP4E116RecoveryCurrentBar_db5cca, leaf_isQqqP4E120RecoveryCurrentBar_db5cca, leaf_isQqqP4E124RecoveryCurrentBar_db5cca, leaf_isQqqP4E127RecoveryCurrentBar_db5cca, leaf_isQqqP4E129RecoveryCurrentBar_db5cca, leaf_isQqqP4E133RecoveryCurrentBar_db5cca, leaf_isQqqP4E137RecoveryCurrentBar_db5cca, leaf_isQqqP4E139RecoveryCurrentBar_db5cca].some(test => test(row)); }
export function isQqqP4E152RecoveryCurrentBar_db5cca(row: Row): boolean {
    return memoValue(row, 'isQqqP4E152RecoveryCurrentBar_db5cca', () => isQqqP4E152RecoveryCurrentBar_db5ccaImpl(row));
}
function isQqqP4E152RecoveryCurrentBar_db5ccaImpl(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentVix = vix_db5cca(row);
    const currentSma = finite_db5cca(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
    const currentLower = lower_db5cca(row);
    const selectedSigma = sigma_db5cca(row);
    const weakeningSr02 = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && currentVix >= 20 && currentVix < 25 && currentLower >= .45 && currentLower < .49 && selectedSigma === 2.5;
    const sr01SmaQuality = row.market.slowSubregime === 'SR01' && currentSma >= .05 && currentSma < .1 && ((row.market.regime === 'RANGE_BOUND' && currentRv >= .5 && currentRv < .6)
        || (row.market.regime === 'RISK_ON_EXTENDED' && currentRv < .3));
    const bullSr02Sma = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentRv >= .4 && currentRv < .5 && currentSma >= 0 && currentSma < .05;
    return isQqqP4E139RecoveryCurrentBar_db5cca(row) || weakeningSr02 || sr01SmaQuality || bullSr02Sma;
}
function leaf_isQqqP4E153RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentVix = vix_db5cca(row);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.NaN);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentLower = lower_db5cca(row);
    const selectedSigma = sigma_db5cca(row);
    const extendedSr02 = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && currentRv >= .4 && currentRv < .5 && currentRoc5 >= 0 && currentRoc5 < .01;
    const weakeningSr01 = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && currentVix >= 20 && currentVix < 25 && currentLower >= .4 && currentLower < .45 && selectedSigma === 2.5;
    const sidewaysQuality = row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && ((currentVix >= 25 && currentVix < 30 && currentLower >= .49 && selectedSigma === 2.5)
        || (currentRv >= .3 && currentRv < .4 && currentExtension < 0));
    const rangeQuality = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && currentVix >= 12 && currentVix < 14 && currentLower >= .3 && currentLower < .35 && selectedSigma === 2.5;
    return extendedSr02 || weakeningSr01 || sidewaysQuality || rangeQuality;
}
function leaf_isQqqP4E155RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const currentSma = finite_db5cca(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
    const currentLower = lower_db5cca(row);
    const selectedSigma = sigma_db5cca(row);
    const bullSr01Quality = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && ((currentRv >= .8 && currentRv < 1 && currentSma >= .1 && currentSma < .2)
        || (currentAdx >= 25 && currentAdx < 30 && currentLower >= .45 && currentLower < .49 && selectedSigma === 2.5));
    return bullSr01Quality;
}
function leaf_isQqqP4E160RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentVix = vix_db5cca(row);
    const currentSma = finite_db5cca(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
    const currentLower = lower_db5cca(row);
    const selectedSigma = sigma_db5cca(row);
    const extendedLowVixQuality = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && currentVix < 12 && currentLower >= .3 && currentLower < .35 && selectedSigma === 2.5 && !(currentSma >= .13 && currentRv >= .28);
    return extendedLowVixQuality;
}
function leaf_isQqqP4E164RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const currentLower = lower_db5cca(row);
    const extendedLowRv = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && currentRv < .3 && currentAdx >= 20 && currentAdx < 25 && currentLower < .4;
    return extendedLowRv;
}
function leaf_isQqqP4E170RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
    const currentAdx = adx_db5cca(row);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.POSITIVE_INFINITY);
    const currentLower = lower_db5cca(row);
    const broadBullSr02 = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentExtension >= 0 && currentExtension < 1.5 && currentLower >= .35 && currentLower < .39 && sigma_db5cca(row) === 2.5;
    const trendImpulseMismatch = currentAdx >= 30 && currentRoc5 < -.005 && currentExtension >= .5;
    return broadBullSr02 && !trendImpulseMismatch;
}
function leaf_isQqqP4E173RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentSma = finite_db5cca(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
    const rangeMediumRv = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && currentRv >= .3 && currentRv < .4 && currentSma >= 0 && currentSma < .05 && currentExtension >= -1.5;
    return rangeMediumRv;
}
function leaf_isQqqP4E176RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const currentVix = vix_db5cca(row);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY);
    const sidewaysHighRvQuality = row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && currentRv >= 1 && currentAdx >= 40 && currentAdx < 60 && currentVix < 30 && currentExtension < 1.4;
    return sidewaysHighRvQuality;
}
function leaf_isQqqP4E180RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentSma = finite_db5cca(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
    const currentAdx = adx_db5cca(row);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.POSITIVE_INFINITY);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
    const bullMediumRvQuality = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentRv >= .3 && currentRv < .4 && currentSma >= 0 && currentSma < .05 && !(currentAdx >= 30 && currentRoc5 > .01 && currentExtension >= 1);
    return bullMediumRvQuality;
}
function leaf_isQqqP4E183RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentSma = finite_db5cca(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
    const currentVix = vix_db5cca(row);
    const extendedSr01Quality = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR01' && currentRv >= .4 && currentRv < .5 && currentSma >= .05 && currentSma < .1 && currentVix < 15;
    return extendedSr01Quality;
}
function leaf_isQqqP4E186RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentLower = lower_db5cca(row);
    const currentVix = vix_db5cca(row);
    const rangePositiveQuality = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && currentExtension >= 0 && currentExtension < 1 && currentLower >= .35 && currentLower < .4 && sigma_db5cca(row) === 2 && currentVix < 15.4;
    return rangePositiveQuality;
}
function leaf_isQqqP4E191RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.NaN);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentLower = lower_db5cca(row);
    const sidewaysNegativeRoc = row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && currentRoc5 >= -.02 && currentRoc5 < 0 && currentExtension < 1.5 && (currentExtension < .5 || currentLower >= .35);
    return sidewaysNegativeRoc;
}
function leaf_isQqqP4E196RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentState = `${row.market.regime ?? 'NA'}/${row.market.slowSubregime ?? 'NA'}`;
    const previous = row.history.length >= 2 ? row.history[row.history.length - 2] : undefined;
    const previousState = `${previous?.regime ?? 'NA'}/${previous?.slowSubregime ?? 'NA'}`;
    const currentVix = vix_db5cca(row);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const sidewaysHighVix = currentState === 'SIDEWAYS/SR01' && currentVix >= 26 && currentVix < 30;
    const bullContinuation = previousState === 'BULL/SR02' && currentState === 'BULL/SR02' && currentExtension >= 2 && currentExtension < 3;
    const rangeLowRvContinuation = previousState === 'RANGE_BOUND/SR02' && currentState === 'RANGE_BOUND/SR02' && rv_db5cca(row) >= 0 && rv_db5cca(row) < .3 && currentExtension >= -1.3;
    return sidewaysHighVix || bullContinuation || rangeLowRvContinuation;
}
function leaf_isQqqP4E199RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentLower = lower_db5cca(row);
    const selectedSigma = sigma_db5cca(row);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const rangeLowerSigma = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && currentLower >= .3 && currentLower < .35 && (selectedSigma ?? Number.NaN) >= 2 && (selectedSigma ?? Number.NaN) < 3 && (currentExtension <= -.05 || (currentExtension >= .1 && currentExtension < 1.2));
    return rangeLowerSigma;
}
function leaf_isQqqP4E202RecoveryCurrentBar_db5cca(row: Row): boolean {
    const extendedAdxPocket = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && adx_db5cca(row) >= 16 && adx_db5cca(row) < 20;
    const lowRvHighSmaRisk = rv_db5cca(row) < .31 && finite_db5cca(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY) >= .11;
    return extendedAdxPocket && !lowRvHighSmaRisk;
}
function leaf_isQqqP4E205RecoveryCurrentBar_db5cca(row: Row): boolean {
    const sidewaysLowAdx = row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR02' && adx_db5cca(row) < 20 && (rv_db5cca(row) < .7 || finite_db5cca(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0 || vix_db5cca(row) >= 33);
    return sidewaysLowAdx;
}
function leaf_isQqqP4E208RecoveryCurrentBar_db5cca(row: Row): boolean {
    const weakeningRangePocket = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && lower_db5cca(row) >= .4 && lower_db5cca(row) < .45 && sigma_db5cca(row) === 2.5;
    const bullHighAdxPocket = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && adx_db5cca(row) >= 40 && adx_db5cca(row) < 60;
    const weakeningLowAdxPocket = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && adx_db5cca(row) >= 12 && adx_db5cca(row) < 16;
    return weakeningRangePocket || bullHighAdxPocket || weakeningLowAdxPocket;
}
function leaf_isQqqP4E211RecoveryCurrentBar_db5cca(row: Row): boolean {
    const bullCurrentExtension = row.market.regime === 'BULL' && row.market.slowSubregime === 'CURRENT' && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= 0 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < .5;
    return bullCurrentExtension;
}
function leaf_isQqqP4E213RecoveryCurrentBar_db5cca(row: Row): boolean {
    const bullSr01Extension = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= 1.5 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < 2;
    return bullSr01Extension;
}
function leaf_isQqqP4E216RecoveryCurrentBar_db5cca(row: Row): boolean {
    const rangeAdxExtension = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && adx_db5cca(row) >= 12 && adx_db5cca(row) < 16 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= 1 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < 1.5;
    return rangeAdxExtension;
}
function leaf_isQqqP4E217RecoveryCurrentBar_db5cca(row: Row): boolean {
    const rangeRvExtension = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && rv_db5cca(row) >= .4 && rv_db5cca(row) < .5 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= -1.5 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < -1;
    return rangeRvExtension;
}
function leaf_isQqqP4E218RecoveryCurrentBar_db5cca(row: Row): boolean {
    const bullContractExtension = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && lower_db5cca(row) >= .3 && lower_db5cca(row) < .35 && sigma_db5cca(row) === 1.5 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= 1.5 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < 2;
    return bullContractExtension;
}
function leaf_isQqqP4E221RecoveryCurrentBar_db5cca(row: Row): boolean {
    const sidewaysQuality = row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= -1 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < 0 && rv_db5cca(row) >= 0 && rv_db5cca(row) < .8 && ((finite_db5cca(row.market.roc5, Number.NaN) >= 0 && finite_db5cca(row.market.roc5, Number.NaN) < .01) || (rv_db5cca(row) >= .67 && rv_db5cca(row) < .8));
    const rangeQuality = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && adx_db5cca(row) >= 16 && adx_db5cca(row) < 20 && rv_db5cca(row) >= .5 && rv_db5cca(row) < .67;
    return sidewaysQuality || rangeQuality;
}
function leaf_isQqqP4E223RecoveryCurrentBar_db5cca(row: Row): boolean {
    const rangeSr01Clean = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR01' && rv_db5cca(row) >= .3 && rv_db5cca(row) < .4 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < -1.5;
    return rangeSr01Clean;
}
function leaf_isQqqP4E225RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentLower = lower_db5cca(row);
    const currentSigma = sigma_db5cca(row);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const bullWideLower = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentLower >= .45 && currentLower < .49 && currentSigma === 2.5 && currentExtension >= 0 && currentExtension < .5;
    const weakeningAdxExtension = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && adx_db5cca(row) >= 16 && adx_db5cca(row) < 20 && currentExtension >= -1.5 && currentExtension < -1;
    const bullMediumLower = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentLower >= .4 && currentLower < .45 && currentSigma === 2.5 && currentExtension >= 1.5 && currentExtension < 2;
    return bullWideLower || weakeningAdxExtension || bullMediumLower;
}
function leaf_isQqqP4E227RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentLower = lower_db5cca(row);
    const currentSigma = sigma_db5cca(row);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const extendedContract = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && currentLower >= .3 && currentLower < .35 && currentSigma === 1.5 && currentExtension >= 2 && currentExtension < 3;
    const bullLowSigma = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentLower >= .3 && currentLower < .35 && currentSigma === 2 && currentExtension >= 0 && currentExtension < .5;
    return extendedContract || bullLowSigma;
}
function leaf_isQqqP4E230RecoveryCurrentBar_db5cca(row: Row): boolean {
    const previous = row.history.length >= 2 ? row.history[row.history.length - 2] : undefined;
    const sameState = (regime: string, slowSubregime: string) => previous?.regime === regime && previous?.slowSubregime === slowSubregime && row.market.regime === regime && row.market.slowSubregime === slowSubregime;
    const currentLower = lower_db5cca(row);
    const currentSigma = sigma_db5cca(row);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const bullContractTransition = sameState('BULL', 'SR02') && currentLower >= .3 && currentLower < .35 && currentSigma === 1.5 && currentExtension >= 1 && currentExtension < 1.5;
    const rangeContractTransition = sameState('RANGE_BOUND', 'SR02') && currentLower >= .35 && currentLower < .4 && currentSigma === 2 && currentExtension >= -1 && currentExtension < 0;
    return bullContractTransition || rangeContractTransition;
}
function isQqqP4E230RecoveryCurrentBar_db5cca(row: Row): boolean { return [isQqqP4E152RecoveryCurrentBar_db5cca, leaf_isQqqP4E153RecoveryCurrentBar_db5cca, leaf_isQqqP4E155RecoveryCurrentBar_db5cca, leaf_isQqqP4E160RecoveryCurrentBar_db5cca, leaf_isQqqP4E164RecoveryCurrentBar_db5cca, leaf_isQqqP4E170RecoveryCurrentBar_db5cca, leaf_isQqqP4E173RecoveryCurrentBar_db5cca, leaf_isQqqP4E176RecoveryCurrentBar_db5cca, leaf_isQqqP4E180RecoveryCurrentBar_db5cca, leaf_isQqqP4E183RecoveryCurrentBar_db5cca, leaf_isQqqP4E186RecoveryCurrentBar_db5cca, leaf_isQqqP4E191RecoveryCurrentBar_db5cca, leaf_isQqqP4E196RecoveryCurrentBar_db5cca, leaf_isQqqP4E199RecoveryCurrentBar_db5cca, leaf_isQqqP4E202RecoveryCurrentBar_db5cca, leaf_isQqqP4E205RecoveryCurrentBar_db5cca, leaf_isQqqP4E208RecoveryCurrentBar_db5cca, leaf_isQqqP4E211RecoveryCurrentBar_db5cca, leaf_isQqqP4E213RecoveryCurrentBar_db5cca, leaf_isQqqP4E216RecoveryCurrentBar_db5cca, leaf_isQqqP4E217RecoveryCurrentBar_db5cca, leaf_isQqqP4E218RecoveryCurrentBar_db5cca, leaf_isQqqP4E221RecoveryCurrentBar_db5cca, leaf_isQqqP4E223RecoveryCurrentBar_db5cca, leaf_isQqqP4E225RecoveryCurrentBar_db5cca, leaf_isQqqP4E227RecoveryCurrentBar_db5cca, leaf_isQqqP4E230RecoveryCurrentBar_db5cca].some(test => test(row)); }
function leaf_isQqqP4E233RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    if (stableRun < 3)
        return isQqqP4E230RecoveryCurrentBar_db5cca(row);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.NaN);
    const currentAdx = adx_db5cca(row);
    const sideways = row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && currentExtension >= -1 && currentExtension < 0 && ((currentRoc5 >= 0 && currentRoc5 < .05) || (currentAdx >= 40 && currentAdx < 60));
    const range = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && currentExtension >= 1.5 && currentExtension < 2 && currentRoc5 >= 0 && currentRoc5 < .01;
    const bull = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentExtension >= 1 && currentExtension < 1.5 && currentRoc5 >= .02 && currentRoc5 < .05;
    return sideways || range || bull;
}
function leaf_isQqqP4E236RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentRv = rv_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const bullDeep = stableRun >= 4 && row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentAdx >= 30 && currentAdx < 40 && currentRv >= .4 && currentRv < .5;
    const sidewaysDeep = stableRun >= 4 && row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && currentAdx >= 30 && currentAdx < 40 && currentExtension >= -1.5 && currentExtension < -1;
    const rangeDeep = stableRun >= 4 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && lower_db5cca(row) >= .45 && lower_db5cca(row) < .49 && sigma_db5cca(row) === 2.5 && currentExtension >= 0 && currentExtension < .5;
    return bullDeep || sidewaysDeep || rangeDeep;
}
function leaf_isQqqP4E238RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.NaN);
    const currentRv = rv_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const bull = stableRun >= 5 && row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentExtension >= .5 && currentExtension < 1 && ((currentRoc5 >= -.02 && currentRoc5 < 0) || (lower_db5cca(row) >= .4 && lower_db5cca(row) < .45 && sigma_db5cca(row) === 2.5));
    const range = stableRun >= 5 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && lower_db5cca(row) >= .4 && lower_db5cca(row) < .45 && sigma_db5cca(row) === 2 && currentRv >= .5 && currentRv < .67;
    const extended = stableRun >= 5 && row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && currentAdx >= 25 && currentAdx < 30 && currentRv >= .4 && currentRv < .5;
    return bull || range || extended;
}
function leaf_isQqqP4E241RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.NaN);
    const currentRv = rv_db5cca(row);
    const bull = stableRun >= 5 && row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentRoc5 >= -.02 && currentRoc5 < 0 && currentExtension >= -1 && currentExtension < 0;
    const range = stableRun >= 5 && row.market.regime === 'RANGE_BOUND' && ((row.market.slowSubregime === 'SR02' && lower_db5cca(row) >= .35 && lower_db5cca(row) < .4 && sigma_db5cca(row) === 2.5 && currentRv >= .3 && currentRv < .4)
        || (row.market.slowSubregime === 'SR01' && currentAdxBelow_db5cca(row, 12) && vix_db5cca(row) < 15));
    return bull || range;
}
function leaf_isQqqP4E245RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const extended = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= 2 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < 3 && ((stableRun >= 5 && adx_db5cca(row) >= 40 && adx_db5cca(row) < 60)
        || (stableRun >= 3 && finite_db5cca(row.market.roc5, Number.NaN) >= .01 && finite_db5cca(row.market.roc5, Number.NaN) < .02 && rv_db5cca(row) >= .38));
    return extended;
}
function leaf_isQqqP4E248RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const lowVolExtended = stableRun >= 5 && row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && rv_db5cca(row) < .3 && vix_db5cca(row) < 12;
    return lowVolExtended;
}
function leaf_isQqqP4E252RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const rangePocket = stableRun >= 5 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && adx_db5cca(row) >= 10 && adx_db5cca(row) < 12 && finite_db5cca(row.market.roc5, Number.NaN) >= -.02 && finite_db5cca(row.market.roc5, Number.NaN) < 0;
    return rangePocket;
}
function leaf_isQqqP4E255RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const extendedPocket = stableRun >= 7 && row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && lower_db5cca(row) >= .3 && lower_db5cca(row) < .35 && sigma_db5cca(row) === 2.5 && rv_db5cca(row) >= .25 && rv_db5cca(row) < .3;
    return extendedPocket;
}
function leaf_isQqqP4E270RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const selectedLower = lower_db5cca(row);
    const selectedSigma = sigma_db5cca(row);
    const extendedTrend = stableRun >= 7 && row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && adx_db5cca(row) >= 30 && adx_db5cca(row) < 40 && finite_db5cca(row.market.roc20, Number.NaN) >= .02 && finite_db5cca(row.market.roc20, Number.NaN) < .05 && selectedSigma === 2.5;
    const rangeQuality = finite_db5cca(row.market.rsi14, Number.NEGATIVE_INFINITY) >= 60
        || finite_db5cca(row.market.weakeningSignalCount, Number.NEGATIVE_INFINITY) >= 1;
    const rangeRecovery = stableRun >= 3 && stableRun < 10 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 12 && vix_db5cca(row) < 15 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= 1 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < 1.5 && selectedLower >= .3 && selectedLower < .42 && (selectedSigma === 2 || selectedSigma === 2.5) && rangeQuality;
    return extendedTrend || rangeRecovery;
}
function leaf_isQqqP4E278RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const rangeContinuation = stableRun >= 5 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 12 && vix_db5cca(row) < 15 && finite_db5cca(row.market.roc5, Number.NaN) >= 0 && finite_db5cca(row.market.roc5, Number.NaN) < .01;
    const bullMediumLowRv = stableRun >= 3 && row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && rv_db5cca(row) >= .38 && rv_db5cca(row) < .4;
    return rangeContinuation || bullMediumLowRv;
}
function leaf_isQqqP4E283RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const extendedLowRv = stableRun < 7 && row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && rv_db5cca(row) >= 0 && rv_db5cca(row) < .25 && !(adx_db5cca(row) >= 29 && adx_db5cca(row) < 30);
    const rangeShortSigma15 = stableRun < 3 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= 1.5 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < 2 && sigma_db5cca(row) === 1.5;
    const rangeStableExtension = stableRun >= 7 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= -1 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < -.2;
    return extendedLowRv || rangeShortSigma15 || rangeStableExtension;
}
function leaf_isQqqP4E286RecoveryCurrentBar_db5cca(row: Row): boolean {
    const label = `${row.market.regime}/${row.market.slowSubregime}`;
    const rangeSr01 = label === 'RANGE_BOUND/SR01' && vix_db5cca(row) >= 15 && vix_db5cca(row) < 17 && finite_db5cca(row.market.rsi14, Number.NaN) >= 35 && finite_db5cca(row.market.rsi14, Number.NaN) < 45;
    const extendedSr02 = label === 'RISK_ON_EXTENDED/SR02' && rv_db5cca(row) >= .3 && rv_db5cca(row) < .38 && adx_db5cca(row) >= 12 && adx_db5cca(row) < 16;
    return rangeSr01 || extendedSr02;
}
function leaf_isQqqP4E290RecoveryCurrentBar_db5cca(row: Row): boolean {
    const label = `${row.market.regime}/${row.market.slowSubregime}`;
    const currentLower = lower_db5cca(row);
    const currentRv = rv_db5cca(row);
    const bullLowerRv = label === 'BULL/SR02' && currentLower >= .42 && currentLower < .45 && currentRv >= .3 && currentRv < .38;
    const bullLowRv = label === 'BULL/SR02' && currentRv >= .25 && currentRv < .3;
    const rangeRsi = label === 'RANGE_BOUND/SR02' && vix_db5cca(row) >= 17 && vix_db5cca(row) < 20 && finite_db5cca(row.market.rsi14, Number.NaN) >= 55 && finite_db5cca(row.market.rsi14, Number.NaN) < 60;
    return bullLowerRv || bullLowRv || rangeRsi;
}
function isQqqP4E290RecoveryCurrentBar_db5cca(row: Row): boolean { return [isQqqP4E152RecoveryCurrentBar_db5cca, leaf_isQqqP4E153RecoveryCurrentBar_db5cca, leaf_isQqqP4E155RecoveryCurrentBar_db5cca, leaf_isQqqP4E160RecoveryCurrentBar_db5cca, leaf_isQqqP4E164RecoveryCurrentBar_db5cca, leaf_isQqqP4E170RecoveryCurrentBar_db5cca, leaf_isQqqP4E173RecoveryCurrentBar_db5cca, leaf_isQqqP4E176RecoveryCurrentBar_db5cca, leaf_isQqqP4E180RecoveryCurrentBar_db5cca, leaf_isQqqP4E183RecoveryCurrentBar_db5cca, leaf_isQqqP4E186RecoveryCurrentBar_db5cca, leaf_isQqqP4E191RecoveryCurrentBar_db5cca, leaf_isQqqP4E196RecoveryCurrentBar_db5cca, leaf_isQqqP4E199RecoveryCurrentBar_db5cca, leaf_isQqqP4E202RecoveryCurrentBar_db5cca, leaf_isQqqP4E205RecoveryCurrentBar_db5cca, leaf_isQqqP4E208RecoveryCurrentBar_db5cca, leaf_isQqqP4E211RecoveryCurrentBar_db5cca, leaf_isQqqP4E213RecoveryCurrentBar_db5cca, leaf_isQqqP4E216RecoveryCurrentBar_db5cca, leaf_isQqqP4E217RecoveryCurrentBar_db5cca, leaf_isQqqP4E218RecoveryCurrentBar_db5cca, leaf_isQqqP4E221RecoveryCurrentBar_db5cca, leaf_isQqqP4E223RecoveryCurrentBar_db5cca, leaf_isQqqP4E225RecoveryCurrentBar_db5cca, leaf_isQqqP4E227RecoveryCurrentBar_db5cca, leaf_isQqqP4E230RecoveryCurrentBar_db5cca, leaf_isQqqP4E233RecoveryCurrentBar_db5cca, leaf_isQqqP4E236RecoveryCurrentBar_db5cca, leaf_isQqqP4E238RecoveryCurrentBar_db5cca, leaf_isQqqP4E241RecoveryCurrentBar_db5cca, leaf_isQqqP4E245RecoveryCurrentBar_db5cca, leaf_isQqqP4E248RecoveryCurrentBar_db5cca, leaf_isQqqP4E252RecoveryCurrentBar_db5cca, leaf_isQqqP4E255RecoveryCurrentBar_db5cca, leaf_isQqqP4E270RecoveryCurrentBar_db5cca, leaf_isQqqP4E278RecoveryCurrentBar_db5cca, leaf_isQqqP4E283RecoveryCurrentBar_db5cca, leaf_isQqqP4E286RecoveryCurrentBar_db5cca, leaf_isQqqP4E290RecoveryCurrentBar_db5cca].some(test => test(row)); }
const e307_6b1c48 = (row: Row) => isQqqP4E290RecoveryCurrentBar_db5cca(row) || (f_6b1c48(row.market.adx14) >= 10 && f_6b1c48(row.market.adx14) < 12 && f_6b1c48(row.market.priceExtensionAtr) >= 2 && f_6b1c48(row.market.priceExtensionAtr) < 3) || (f_6b1c48(row.market.vixTermStructureSlope) < -.1 && f_6b1c48(row.market.distanceToSma20Pct) >= -.02 && f_6b1c48(row.market.distanceToSma20Pct) < 0);
export function isQqqP4E152MergedCurrentBarReject_db5cca(row: Row): boolean {
    return memoValue(row, 'isQqqP4E152MergedCurrentBarReject_db5cca', () => isQqqP4E152MergedCurrentBarReject_db5ccaImpl(row));
}
function isQqqP4E152MergedCurrentBarReject_db5ccaImpl(row: Row): boolean {
    return isQqqP4E68MergedCurrentBarReject_db5cca(row) && !isQqqP4E152RecoveryCurrentBar_db5cca(row);
}
const e336_6b1c48 = (row: Row) => (row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && f_6b1c48(row.market.vixTermStructureSlope) < 2.5 && f_6b1c48(row.market.vixChange5d) < .1) || (row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && f_6b1c48(row.market.sma20SlopePct) < -.006 && f_6b1c48(row.market.range20dPct) < .091) || (isQqqP4E152MergedCurrentBarReject_db5cca(row) && row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.roc5) >= .0044 && f_6b1c48(row.market.range20dPct) >= .0651) || (row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'CURRENT' && f_6b1c48(row.market.adx14) < 12) || (row.market.regime === 'BULL' && row.market.slowSubregime === 'CURRENT' && f_6b1c48(row.market.vixTermStructureSlope) < 2.5) || (row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.vix) < 14 && f_6b1c48(row.market.roc20) < 0) || (row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.adx14) >= 15 && f_6b1c48(row.market.priceExtensionAtr) < 3) || (row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && f_6b1c48(row.market.range20dPct) < .12 && f_6b1c48(row.market.sma20SlopePct) < -.02) || (row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && f_6b1c48(row.market.range20dPct) < .091 && f_6b1c48(row.market.vixTermStructureSlope) < 1) || (row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.adx14) < 10 && f_6b1c48(row.market.rsi14) < 50);
const e348_6b1c48 = (row: Row) => e336_6b1c48(row) || (row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.vix) < 14 && f_6b1c48(row.market.adx14) < 10 && f_6b1c48(row.market.vixTermStructureSlope) >= 2) || (row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.vix) >= 12 && f_6b1c48(row.market.priceExtensionAtr) >= 3 && f_6b1c48(row.market.range20dPct) >= .091) || (row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.vix) < 14 && f_6b1c48(row.market.adx14) < 20 && f_6b1c48(row.market.priceExtensionAtr) >= 1.5);
const e354Micro_6b1c48 = (row: Row) => (row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.adx14) >= 30 && f_6b1c48(row.market.roc5) >= .02 && f_6b1c48(row.market.rsi14) < 70) || (row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR01' && f_6b1c48(row.market.adx14) >= 25 && f_6b1c48(row.market.priceExtensionAtr) >= 2.5 && f_6b1c48(row.market.roc5) < .02) || (row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && f_6b1c48(row.market.vix) < 25 && f_6b1c48(row.market.range20dPct) >= .16 && f_6b1c48(row.market.vixChange5d) >= -.1) || (row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.adx14) >= 15 && f_6b1c48(row.market.priceExtensionAtr) >= 0 && f_6b1c48(row.market.sma20SlopePct) < 0);
const e315Bypass_6b1c48 = (row: Row) => row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.adx14) >= 35 && f_6b1c48(row.market.tqqqRealisedVol20d) < .3 && (f_6b1c48(row.market.vix) < 13.5 || f_6b1c48(row.market.priceExtensionAtr) < .5 || f_6b1c48(row.market.priceExtensionAtr) >= 1.8);
export const p6ContextRow = contextRow_db5cca;
export const p6CurrentBlock = currentBlock_db5cca;
export const p6PriceSmaBlock = priceSmaBlock_db5cca;
export const p6CurrentArm = currentArmEquivalent_db5cca;
export const p6P1Block = p1Compact_db5cca;
export const p6CandidateA = candidateAState_db5cca;
export const p6Rules = rules_db5cca;
export const p6FinalReject = finalCurrentBarReject_db5cca;
export const p6ResearchReject = p6e369Reject_8e756a;
export const p6ExtraAdmission = p6e220Admission_bd991b;
export const p6E307 = e307_6b1c48;
export const p6E348 = e348_6b1c48;
export const p6E354 = e354Micro_6b1c48;
export const p6ProtectionBypass = e315Bypass_6b1c48;
export const p6RejectQualityGuard = isQqqP4E152MergedCurrentBarReject_db5cca;


export {isQqqP4E54FlatMergedCurrentBarReject_db5cca,isQqqP4E56RecoveryCurrentBar_db5cca,isQqqP4E57RecoveryCurrentBar_db5cca,isQqqP4E58RecoveryCurrentBar_db5cca,isQqqP4E59RecoveryCurrentBar_db5cca,isQqqP4E61RecoveryCurrentBar_db5cca,isQqqP4E62RecoveryCurrentBar_db5cca,isQqqP4E63RecoveryCurrentBar_db5cca,isQqqP4E65RecoveryCurrentBar_db5cca,isQqqP4E66RecoveryCurrentBar_db5cca,isQqqP4E67RecoveryCurrentBar_db5cca,isQqqP4E68RecoveryCurrentBar_db5cca,isQqqP4E104RecoveryCurrentBar_db5cca};
