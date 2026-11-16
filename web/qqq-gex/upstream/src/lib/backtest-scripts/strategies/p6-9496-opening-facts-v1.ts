import { trailingStateRun, lastThreeStateSequence, createDecisionMemo } from '../current-bar-facts-v4';

import type { PcsDynamicEntryContext, PcsDynamicMarketState } from '../../engines/leveraged-overlay/types/input';

import { isPcsCandidate3ExtraRelease } from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';

import { isPcsCandidate3TimingWindow } from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';

import { isPcsV12GateBlocked } from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';

import { isPcsV121Simple5Release } from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';

import { evaluatePcsRiskEnvelope } from '../../engines/leveraged-overlay/v2/strategies/pcs-risk-envelope';

import { evaluatePcsV123Gate } from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';

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

const finite_db5cca = (value: number | null | undefined, fallback: number) => value ?? fallback;

const adx_db5cca = (row: Row) => finite_db5cca(row.market.adx14, Number.POSITIVE_INFINITY);

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
        history: context.history.map((state) => ({ regime: state.regime, slowSubregime: state.slowSubregime })) as State[],
        selection: {
            selectedNoTouchLower: context.selectedNoTouchLower,
            selectedSigma: context.selectedSigma,
            openCredit: context.openCredit,
        },
    };
    Object.defineProperty(row, 'evaluationMemo', { value: createDecisionMemo() });
    return row;
}

const vix_db5cca = (row: Row) => finite_db5cca(row.market.vix, Number.POSITIVE_INFINITY);

function currentBlock_db5cca(market: State): boolean { return market.regime === 'BULL' && (finite_db5cca(market.adx14, Number.NEGATIVE_INFINITY) >= 29 && finite_db5cca(market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2 && market.slowSubregime === 'SR01' || finite_db5cca(market.adx14, Number.NEGATIVE_INFINITY) >= 40 && market.slowSubregime === 'SR02' && vix_db5cca({ market: market } as Row) < 18 && vix_db5cca({ market: market } as Row) >= 15) || finite_db5cca(market.adx14, Number.POSITIVE_INFINITY) < 12 && market.regime === 'RISK_ON_WEAKENING' && market.slowSubregime === 'SR01'; }

const f_6b1c48 = (value: number | null | undefined) => Number.isFinite(value) ? value as number : Number.NaN;

const e315Bypass_6b1c48_riskRole = (row: Row) => { return f_6b1c48(row.market.vix) < 12 || f_6b1c48(row.market.priceExtensionAtr) < 0.5 || f_6b1c48(row.market.priceExtensionAtr) >= 2; };

const rv_db5cca = (row: Row) => finite_db5cca(row.market.tqqqRealisedVol20d, Number.NEGATIVE_INFINITY);

function finalCurrentBarReject_db5cca(row: Row, includeP4E2Protection = true): string | undefined {
    const market = row.market;
    const currentVix = vix_db5cca(row);
    const currentRv = rv_db5cca(row);
    const currentAdx = adx_db5cca(row);
    // E222 was historically applied only when the separate base arm produced
    // the same date. A current-bar profile has no base-arm membership signal;
    // applying it to every contract path incorrectly vetoes valid pool rows, so
    // the merged current-bar builder intentionally omits that cross-arm veto.
    const extended = market.regime === 'RISK_ON_EXTENDED' && market.slowSubregime === 'SR01' && currentVix < 20 && currentRv >= 0.5 && currentRv < 0.6 && currentAdx >= 20 && currentAdx < 30;
    const bullPe21 = market.regime === 'BULL' && market.slowSubregime === 'SR02' && currentVix < 15 && currentRv >= 0.5 && currentRv < 0.6 && currentAdx >= 20 && currentAdx < 30 && finite_db5cca(market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2.1;
    const extendedSr02 = market.regime === 'RISK_ON_EXTENDED' && market.slowSubregime === 'SR02' && currentVix < 18 && currentRv >= 0.45 && currentRv < 0.6 && currentAdx < 12 && finite_db5cca(market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2.1;
    const weakeningCompact = market.regime === 'RISK_ON_WEAKENING' && market.slowSubregime === 'SR02' && currentVix < 17 && currentAdx >= 12 && currentAdx < 17 && currentRv < 0.4;
    const bullSr01TrendExtension = market.regime === 'BULL' && market.slowSubregime === 'SR01' && currentVix < 18 && currentAdx >= 20 && currentAdx < 30 && currentRv >= 0.5 && currentRv < 0.6 && finite_db5cca(market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2.5;
    // P4.E3 replaces the broader E2 protection with the narrower boundary
    // that preserves most profitable trades while retaining its loss filter.
    const bullSr02LowRvTrend = includeP4E2Protection && market.regime === 'BULL' && market.slowSubregime === 'SR02' && currentVix < 17 && currentAdx >= 35 && currentRv < 0.3;
    if (extended || bullPe21 || extendedSr02)
        return 'P4_E234_STRESS_STATE';
    if (weakeningCompact)
        return 'P4_COMPACT_WEAKENING_STATE';
    if (bullSr02LowRvTrend)
        return 'P4_E3_BULL_SR02_LOW_RV_TREND';
    if (bullSr01TrendExtension)
        return 'P4_E222_TREND_EXTENSION';
    if (market.regime === 'BULL' && market.slowSubregime === 'SR01' && currentVix < 15 && currentRv < 0.4 && currentAdx >= 25)
        return 'P4_E277_LOW_RV_TREND';
    return undefined;
}

function isQqqP4E103RecoveryCurrentBar_db5cca(row: Row): boolean {
    return (adx_db5cca((row)))
        >= 40 && ((finite_db5cca((row).market.roc5, Number.NaN))
        >= 0.0044 && (finite_db5cca((row).market.rsi14, Number.NaN))
        < 72 && (row).market.slowSubregime === 'SR02' || (finite_db5cca((row).market.roc5, Number.NaN))
        >= 0.03 && (row).market.regime === 'RISK_ON_EXTENDED') || (adx_db5cca((row)))
        >= 20 && (finite_db5cca((row).market.priceExtensionAtr, Number.NaN))
        < 0.5 && (finite_db5cca((row).market.priceExtensionAtr, Number.NaN))
        >= 0 && (finite_db5cca((row).market.roc5, Number.NaN))
        >= 0 && (row).market.slowSubregime === 'SR02';
}

const memoValue = <T>(row: Row, key: string, compute: () => T): T => {
    const memo = (row as unknown as {
        evaluationMemo?: ReturnType<typeof createDecisionMemo>;
    }).evaluationMemo;
    return memo ? memo(key, compute) : compute();
};

function isQqqP4E104RecoveryCurrentBar_db5ccaImpl(row: Row): boolean {
    const broadQualityBull = row.market.regime === 'BULL' && ['CURRENT', 'SR01', 'SR02'].includes(row.market.slowSubregime ?? '') && vix_db5cca(row) < 16 && rv_db5cca(row) < 0.67 && (adx_db5cca(row) >= 17 && adx_db5cca(row) < 30 && finite_db5cca(row.market.roc5, Number.NEGATIVE_INFINITY) >= 0.015 || adx_db5cca(row) >= 30 && adx_db5cca(row) < 35 && finite_db5cca(row.market.roc5, Number.NEGATIVE_INFINITY) >= 0.02);
    return isQqqP4E103RecoveryCurrentBar_db5cca(row) || broadQualityBull;
}

function isQqqP4E104RecoveryCurrentBar_db5cca(row: Row): boolean {
    return memoValue(row, 'isQqqP4E104RecoveryCurrentBar_db5cca', () => isQqqP4E104RecoveryCurrentBar_db5ccaImpl(row));
}

function leaf_isQqqP4E109RecoveryCurrentBar_db5cca(row: Row): boolean {
    return row.market.slowSubregime === 'SR02' && (adx_db5cca(row))
        >= 20 && (adx_db5cca(row))
        < 25 && (finite_db5cca(row.market.roc5, Number.NEGATIVE_INFINITY))
        >= 0.02 && (finite_db5cca(row.market.roc5, Number.NEGATIVE_INFINITY))
        < 0.03 || row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR01' && (adx_db5cca(row))
        >= 18 || row.market.regime === 'BULL' && (adx_db5cca(row))
        >= 30 && (adx_db5cca(row))
        < 35 && (rv_db5cca(row))
        >= 0.4 && (rv_db5cca(row))
        < 0.5;
}

function leaf_isQqqP4E116RecoveryCurrentBar_db5cca(row: Row): boolean {
    return (rv_db5cca(row))
        < 0.3 && ((adx_db5cca(row))
        < 16 && row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' || (vix_db5cca(row))
        < 16 && row.market.regime === 'RANGE_BOUND') || (rv_db5cca(row))
        >= 0.4 && ((rv_db5cca(row))
        < 0.5 && (vix_db5cca(row))
        < 16 && (vix_db5cca(row))
        >= 14 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR01' || (vix_db5cca(row))
        < 12 && row.market.regime === 'BULL') || (vix_db5cca(row))
        < 14 && row.market.regime === 'RISK_ON_WEAKENING' || (vix_db5cca(row))
        < 12 && row.market.slowSubregime === 'SR01';
}

function leaf_isQqqP4E120RecoveryCurrentBar_db5cca(row: Row): boolean {
    return row.market.slowSubregime === 'SR01' && ((finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        >= 3 && (rv_db5cca(row))
        < 0.4 && (rv_db5cca(row))
        >= 0.3 || (rv_db5cca(row))
        >= 0.8 && row.market.regime === 'RISK_ON_WEAKENING') || (finite_db5cca(row.market.rsi14, Number.NEGATIVE_INFINITY))
        >= 60 && (vix_db5cca(row))
        < 12 && row.market.regime === 'BULL';
}

const lower_db5cca = (row: Row) => finite_db5cca(row.selection?.selectedNoTouchLower, Number.NEGATIVE_INFINITY);

const sigma_db5cca = (row: Row) => row.selection?.selectedSigma;

function leaf_isQqqP4E124RecoveryCurrentBar_db5cca(row: Row): boolean {
    const weakeningPath = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && rv_db5cca(row) >= 0.67 && rv_db5cca(row) < 0.8 && lower_db5cca(row) >= 0.45 && lower_db5cca(row) < 0.49 && sigma_db5cca(row) === 2.5;
    return weakeningPath;
}

function leaf_isQqqP4E127RecoveryCurrentBar_db5cca(row: Row): boolean {
    const sidewaysRvRecovery = row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && rv_db5cca(row) >= 0.5 && rv_db5cca(row) < 0.6 && !(adx_db5cca(row) < 20 && finite_db5cca(row.market.roc5, Number.POSITIVE_INFINITY) <= -0.02);
    return sidewaysRvRecovery;
}

function leaf_isQqqP4E129RecoveryCurrentBar_db5cca(row: Row): boolean {
    return (rv_db5cca(row))
        >= 0.6 && ((adx_db5cca(row))
        < 25 && (rv_db5cca(row))
        < 0.67 && row.market.regime === 'SIDEWAYS' || (finite_db5cca(row.market.roc5, Number.NaN))
        >= 0.02 && row.market.regime === 'RANGE_BOUND') || (adx_db5cca(row))
        < 16 && (rv_db5cca(row))
        >= 1;
}

function leaf_isQqqP4E133RecoveryCurrentBar_db5cca(row: Row): boolean {
    const extendedPositive = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && rv_db5cca(row) >= 0.3 && rv_db5cca(row) < 0.4 && adx_db5cca(row) >= 20 && adx_db5cca(row) < 25 && finite_db5cca(row.market.roc5, Number.NEGATIVE_INFINITY) >= 0.01;
    return extendedPositive;
}

function leaf_isQqqP4E137RecoveryCurrentBar_db5cca(row: Row): boolean {
    const previous = row.history.length >= 2 ? row.history[row.history.length - 2] : undefined;
    const bullCurrentTransition = previous?.regime === 'BULL' && previous.slowSubregime === 'CURRENT';
    return bullCurrentTransition;
}

function leaf_isQqqP4E139RecoveryCurrentBar_db5cca(row: Row): boolean {
    return (`${(row.history.length >= 2 ? row.history[row.history.length - 2] : undefined)
        ?.regime ?? 'NA'}/${(row.history.length >= 2 ? row.history[row.history.length - 2] : undefined)
        ?.slowSubregime ?? 'NA'}`)
        === 'RISK_ON_WEAKENING/SR01' && (`${row.market.regime ?? 'NA'}/${row.market.slowSubregime ?? 'NA'}`)
        === 'BULL/SR01' && rv_db5cca(row) >= 0.6 || (`${(row.history.length >= 2 ? row.history[row.history.length - 2] : undefined)
        ?.regime ?? 'NA'}/${(row.history.length >= 2 ? row.history[row.history.length - 2] : undefined)
        ?.slowSubregime ?? 'NA'}`)
        === 'RISK_ON_EXTENDED/SR02' && (`${row.market.regime ?? 'NA'}/${row.market.slowSubregime ?? 'NA'}`)
        === 'BULL/SR02' && rv_db5cca(row) >= 0.3 && rv_db5cca(row) < 0.4 && lower_db5cca(row) >= 0.35;
}

function isQqqP4E139RecoveryCurrentBar_db5cca(row: Row): boolean { return [isQqqP4E104RecoveryCurrentBar_db5cca, leaf_isQqqP4E109RecoveryCurrentBar_db5cca, leaf_isQqqP4E116RecoveryCurrentBar_db5cca, leaf_isQqqP4E120RecoveryCurrentBar_db5cca, leaf_isQqqP4E124RecoveryCurrentBar_db5cca, leaf_isQqqP4E127RecoveryCurrentBar_db5cca, leaf_isQqqP4E129RecoveryCurrentBar_db5cca, leaf_isQqqP4E133RecoveryCurrentBar_db5cca, leaf_isQqqP4E137RecoveryCurrentBar_db5cca, leaf_isQqqP4E139RecoveryCurrentBar_db5cca].some(test => test(row)); }

function isQqqP4E54FlatMergedCurrentBarReject_db5cca(row: Row): boolean {
    return (row).market.regime === 'BULL' && (vix_db5cca((row)) < 15 && (rv_db5cca((row)) >= 0.4 && (adx_db5cca((row)) >= 30 && finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2 || adx_db5cca((row)) < 15 && adx_db5cca((row)) >= 12 && rv_db5cca((row)) < 0.5 && vix_db5cca((row)) >= 14) || (row).market.slowSubregime === 'SR01' && adx_db5cca((row)) < 12 && vix_db5cca((row)) >= 14) || adx_db5cca((row)) < 20 && (rv_db5cca((row)) >= 0.8 && vix_db5cca((row)) >= 19 || (row).market.slowSubregime === 'SR02' && adx_db5cca((row)) >= 18 && finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2 && vix_db5cca((row)) >= 14) || finite_db5cca((row).market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0 && (adx_db5cca((row)) < 30 && adx_db5cca((row)) >= 15 && vix_db5cca((row)) < 20 && vix_db5cca((row)) >= 17 || rv_db5cca((row)) < 0.4 && vix_db5cca((row)) < 19 && vix_db5cca((row)) >= 18) || (row).market.slowSubregime === 'CURRENT' && adx_db5cca((row)) >= 25 && vix_db5cca((row)) >= 19 || adx_db5cca((row)) < 17 && finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 1 && vix_db5cca((row)) < 17 && vix_db5cca((row)) >= 16) || (row).market.regime === 'RISK_ON_WEAKENING' && ((row).market.slowSubregime === 'SR01' && (adx_db5cca((row)) < 20 && rv_db5cca((row)) < 0.6 && rv_db5cca((row)) >= 0.45 && vix_db5cca((row)) >= 16 || adx_db5cca((row)) < 22 && vix_db5cca((row)) < 22 && vix_db5cca((row)) >= 20.5 || adx_db5cca((row)) >= 30) || rv_db5cca((row)) < 0.45 && (adx_db5cca((row)) < 15 && adx_db5cca((row)) >= 10 && vix_db5cca((row)) < 16 && vix_db5cca((row)) >= 15 || (row).market.slowSubregime === 'CURRENT' && vix_db5cca((row)) >= 16 || adx_db5cca((row)) < 35 && adx_db5cca((row)) >= 30 && rv_db5cca((row)) >= 0.38) || adx_db5cca((row)) < 16 && finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= -1.3 && vix_db5cca((row)) >= 22) || (vix_db5cca((row)))
        >= 14 && (((row).market.regime)
        === 'BULL' && (((row).market.slowSubregime)
        === 'SR02' && ((rv_db5cca((row)))
        < 0.4 && ((adx_db5cca((row)))
        < 25 && (adx_db5cca((row)))
        >= 15 && (finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        < 1 && (vix_db5cca((row)))
        < 17 || (adx_db5cca((row)))
        < 20 && (finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        >= 1) || (adx_db5cca((row)))
        >= 30 && (finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        < 2 && (finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        >= 0.5 && (rv_db5cca((row)))
        < 0.45) || ((row).market.slowSubregime)
        === 'SR01' && (adx_db5cca((row)))
        < 20 && (finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        < 1 && (rv_db5cca((row)))
        < 0.6 && (rv_db5cca((row)))
        >= 0.4 || (adx_db5cca((row)))
        >= 20 && (finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        < 0 && (rv_db5cca((row)))
        < 0.45 && (rv_db5cca((row)))
        >= 0.3 && (vix_db5cca((row)))
        < 17) || ((row).market.regime)
        === 'RISK_ON_EXTENDED' && (adx_db5cca((row)))
        >= 30 && (rv_db5cca((row)))
        < 0.4 && (rv_db5cca((row)))
        >= 0.3 && (vix_db5cca((row)))
        < 16 || ((row).market.slowSubregime)
        === 'SR02' && (adx_db5cca((row)))
        < 15 && (finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        < 1.5 && (finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        >= 0.5 && (vix_db5cca((row)))
        < 17) || (row).market.slowSubregime === 'SR01' && ((row).market.regime === 'RISK_ON_EXTENDED' && finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 2.5 && rv_db5cca((row)) < 0.38 && vix_db5cca((row)) < 16 && vix_db5cca((row)) >= 14 || (row).market.regime === 'RANGE_BOUND' && adx_db5cca((row)) < 16 && adx_db5cca((row)) >= 15 && finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 0 && rv_db5cca((row)) < 0.45 || adx_db5cca((row)) < 20 && adx_db5cca((row)) >= 10 && finite_db5cca((row).market.vix, Number.NEGATIVE_INFINITY) >= 33) || (rv_db5cca((row)))
        < 0.6 && (((row).market.regime)
        === 'RISK_ON_WEAKENING' && ((row).market.slowSubregime)
        === 'SR02' && ((adx_db5cca((row)))
        >= 25 && (rv_db5cca((row)))
        >= 0.3 && (vix_db5cca((row)))
        >= 19 || (adx_db5cca((row)))
        < 20 && (adx_db5cca((row)))
        >= 10 && (vix_db5cca((row)))
        < 19 && (vix_db5cca((row)))
        >= 16) || ((row).market.regime)
        === 'BULL' && ((row).market.slowSubregime)
        === 'SR01' && (adx_db5cca((row)))
        < 22 && (finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        >= 1.5 && (vix_db5cca((row)))
        >= 19) || (adx_db5cca((row)))
        < 12 && (finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        >= 1.5 && (vix_db5cca((row)))
        >= 22 || ((row).market.slowSubregime)
        === 'SR01' && (adx_db5cca((row)))
        >= 30 && (rv_db5cca((row)))
        < 0.45 && (rv_db5cca((row)))
        >= 0.38 || (adx_db5cca((row)))
        < 10 && (finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        >= 0 && (vix_db5cca((row)))
        >= 33 || (row).market.regime === 'SIDEWAYS' && (row).market.slowSubregime === 'CURRENT' && adx_db5cca((row)) < 10 || (row).market.slowSubregime === 'SR02' && adx_db5cca((row)) < 25 && adx_db5cca((row)) >= 20 && finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 0.5 && finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 0 && vix_db5cca((row)) < 16 && vix_db5cca((row)) >= 15 || adx_db5cca((row)) < 27 && adx_db5cca((row)) >= 25 && finite_db5cca((row).market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 0 && rv_db5cca((row)) < 0.3 || adx_db5cca((row)) < 30 && adx_db5cca((row)) >= 29 && vix_db5cca((row)) >= 22;
}

function isQqqP4E56RecoveryCurrentBar_db5cca_riskRole(row: Row): boolean {
    return row.market.slowSubregime === 'SR02' && ((adx_db5cca(row))
        < 18 && (finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        >= 1 && (rv_db5cca(row))
        < 0.4 || (adx_db5cca(row))
        < 20 && (vix_db5cca(row))
        < 17.25 && (vix_db5cca(row))
        >= 16 && row.market.regime === 'RISK_ON_WEAKENING') || (vix_db5cca(row))
        >= 20.5 && row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01';
}

function isQqqP4E57RecoveryCurrentBar_db5cca_riskRole(row: Row): boolean {
    return row.market.slowSubregime === 'SR01' && (vix_db5cca(row))
        >= 15 && (rv_db5cca(row))
        >= 0.4 && (rv_db5cca(row))
        < 0.5 && (finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        >= 0 || (adx_db5cca(row))
        < 25 && (rv_db5cca(row))
        < 0.4 && (adx_db5cca(row))
        >= 22 || row.market.regime === 'BULL' && (vix_db5cca(row))
        < 17 && (finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        < 0 && (vix_db5cca(row))
        >= 15.5 && (finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        > -0.6;
}

function isQqqP4E58RecoveryCurrentBar_db5cca_riskRole(row: Row): boolean {
    return row.market.slowSubregime === 'SR01' && ((finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        >= 0 && (vix_db5cca(row))
        < 19 && (vix_db5cca(row))
        >= 17.25 || (finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        < -1 && (vix_db5cca(row))
        >= 20.5) || (finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        < 0.5 && (finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        >= 0 && row.market.regime === 'SIDEWAYS';
}

function isQqqP4E59RecoveryCurrentBar_db5cca_riskRole(row: Row): boolean {
    return row.market.regime === 'BULL' && ((adx_db5cca(row))
        < 25 && ((rv_db5cca(row))
        < 0.4 && (vix_db5cca(row))
        < 17 && (vix_db5cca(row))
        >= 15 || (finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        < 0 && (finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        > -0.2) || (adx_db5cca(row))
        >= 30 && (finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        < 2 && (finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        >= 0.5 && (vix_db5cca(row))
        >= 14.3 && row.market.slowSubregime === 'SR02') || (adx_db5cca(row))
        >= 25 && (vix_db5cca(row))
        >= 20.5 && row.market.regime === 'RISK_ON_WEAKENING' || (finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY))
        < -1.5 && (vix_db5cca(row))
        >= 18;
}

function isQqqP4E61RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentAdx = adx_db5cca(row);
    const extension = finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentAdx >= 10 && currentAdx < 30 && extension >= 1 && extension < 1.5;
}

function isQqqP4E62RecoveryCurrentBar_db5cca(row: Row): boolean {
    return row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && (adx_db5cca(row))
        >= 15 && (adx_db5cca(row))
        < 25 && (rv_db5cca(row))
        < 0.5 || row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && (rv_db5cca(row))
        < 0.8 && (finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        < 2;
}

function isQqqP4E63RecoveryCurrentBar_db5cca(row: Row): boolean {
    return false;
}

function isQqqP4E65RecoveryCurrentBar_db5cca(row: Row): boolean {
    return row.market.slowSubregime === 'SR01' && ((finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        < -0.5 && (finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        >= -1 && (rv_db5cca(row))
        >= 0.4 && row.market.regime === 'RISK_ON_WEAKENING' || (finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        < 0 && (finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        >= -0.5 && row.market.regime === 'BULL') || (adx_db5cca(row))
        < 15 && (adx_db5cca(row))
        >= 10 && (finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        >= 0.5;
}

function isQqqP4E66RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRoc20 = finite_db5cca(row.market.roc20, Number.NaN);
    const currentRsi14 = finite_db5cca(row.market.rsi14, Number.NaN);
    return row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && currentRoc20 >= 0.05 && currentRsi14 < 70;
}

function isQqqP4E67RecoveryCurrentBar_db5cca(row: Row): boolean {
    return (finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        < -0.5 && row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && ((finite_db5cca(row.market.rsi14, Number.NaN))
        >= 50 || (finite_db5cca(row.market.roc5, Number.NaN))
        >= 0) || (lower_db5cca(row))
        >= 0.45 && row.market.regime === 'RISK_ON_EXTENDED';
}

function isQqqP4E68RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentVix = vix_db5cca(row);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const selectedLower = lower_db5cca(row);
    return row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && currentVix < 18 && selectedLower >= 0.4 && selectedLower < 0.45 && currentExtension < -0.2;
}

function isQqqP4E68MergedCurrentBarReject_db5ccaImpl_riskRole(row: Row): boolean { return isQqqP4E54FlatMergedCurrentBarReject_db5cca(row) && ![isQqqP4E56RecoveryCurrentBar_db5cca_riskRole, isQqqP4E57RecoveryCurrentBar_db5cca_riskRole, isQqqP4E58RecoveryCurrentBar_db5cca_riskRole, isQqqP4E59RecoveryCurrentBar_db5cca_riskRole, isQqqP4E61RecoveryCurrentBar_db5cca, isQqqP4E62RecoveryCurrentBar_db5cca, isQqqP4E65RecoveryCurrentBar_db5cca, isQqqP4E66RecoveryCurrentBar_db5cca, isQqqP4E67RecoveryCurrentBar_db5cca, isQqqP4E68RecoveryCurrentBar_db5cca].some(test => test(row)); }

function isQqqP4E68MergedCurrentBarReject_db5cca_riskRole(row: Row): boolean {
    return memoValue(row, 'isQqqP4E68MergedCurrentBarReject_db5cca', () => isQqqP4E68MergedCurrentBarReject_db5ccaImpl_riskRole(row));
}

function isQqqP4E152RecoveryCurrentBar_db5ccaImpl(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentVix = vix_db5cca(row);
    const currentSma = finite_db5cca(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
    const currentLower = lower_db5cca(row);
    const selectedSigma = sigma_db5cca(row);
    const weakeningSr02 = row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && currentVix >= 20 && currentVix < 25 && currentLower >= 0.45 && currentLower < 0.49 && selectedSigma === 2.5;
    const sr01SmaQuality = row.market.slowSubregime === 'SR01' && currentSma >= 0.05 && currentSma < 0.1 && (row.market.regime === 'RANGE_BOUND' && currentRv >= 0.5 && currentRv < 0.6 || row.market.regime === 'RISK_ON_EXTENDED' && currentRv < 0.3);
    const bullSr02Sma = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentRv >= 0.4 && currentRv < 0.5 && currentSma >= 0 && currentSma < 0.05;
    return isQqqP4E139RecoveryCurrentBar_db5cca(row) || weakeningSr02 || sr01SmaQuality || bullSr02Sma;
}

function isQqqP4E152RecoveryCurrentBar_db5cca(row: Row): boolean {
    return memoValue(row, 'isQqqP4E152RecoveryCurrentBar_db5cca', () => isQqqP4E152RecoveryCurrentBar_db5ccaImpl(row));
}

function isQqqP4E152MergedCurrentBarReject_db5ccaImpl_riskRole(row: Row): boolean {
    return isQqqP4E68MergedCurrentBarReject_db5cca_riskRole(row) && !isQqqP4E152RecoveryCurrentBar_db5cca(row);
}

function isQqqP4E152MergedCurrentBarReject_db5cca_riskRole(row: Row): boolean {
    return memoValue(row, 'isQqqP4E152MergedCurrentBarReject_db5cca', () => isQqqP4E152MergedCurrentBarReject_db5ccaImpl_riskRole(row));
}

function p1Compact_db5cca(row: Row): boolean {
    const x = vix_db5cca(row);
    return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && x < 17 && finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2.5 && adx_db5cca(row) < 22 && (rv_db5cca(row) < 0.5 || rv_db5cca(row) >= 0.6) || row.market.slowSubregime === 'SR02' && rv_db5cca(row) >= 0.6 && adx_db5cca(row) < 20 && (row.market.regime === 'RISK_ON_EXTENDED' && x >= 20 || row.market.regime === 'BULL' && row.history.slice(-3).length === 3 && row.history.slice(-3).every((state) => state.regime === 'BULL' && state.slowSubregime === 'SR02')) || row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && x >= 20 && adx_db5cca(row) < 15;
}

const p6ContextRow = contextRow_db5cca;

const p6CurrentBlock = currentBlock_db5cca;

const p6FinalReject = finalCurrentBarReject_db5cca;

const p6P1Block = p1Compact_db5cca;

function priceSmaBlock_db5cca(market: State): boolean {
    return market.regime === 'BULL' && market.slowSubregime === 'SR01' && finite_db5cca(market.adx14, Number.POSITIVE_INFINITY) < 18 && rv_db5cca({ market: market } as Row) >= 0.6 && finite_db5cca(market.priceVsSma200Pct, Number.NEGATIVE_INFINITY) >= 0.1;
}

const p6PriceSmaBlock = priceSmaBlock_db5cca;

const p6ProtectionBypass_riskRole = e315Bypass_6b1c48_riskRole;

const p6RejectQualityGuard_riskRole = isQqqP4E152MergedCurrentBarReject_db5cca_riskRole;

function candidateAState_db5cca(market: State): boolean {
    return (market.regime === 'SIDEWAYS' && (finite_db5cca(market.adx14, Number.POSITIVE_INFINITY))
        < 12);
}

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
    const envelopeReleased = evaluatePcsRiskEnvelope(input, 'candidate4_full_only_v1').band !== 'BLOCK';
    const v123 = evaluatePcsV123Gate({ ...input, b30ReleaseLower: .38 });
    return extra || envelopeReleased || (!v121Blocked || isPcsV121Simple5Release(input)) && v123.blockedBy.length === 0;
}

function leaf_isQqqP4E153RecoveryCurrentBar_db5cca(row: Row): boolean {
    return row.market.regime === 'RISK_ON_EXTENDED' && (rv_db5cca(row))
        >= 0.4 && (rv_db5cca(row))
        < 0.5 && (finite_db5cca(row.market.roc5, Number.NaN))
        >= 0 && (finite_db5cca(row.market.roc5, Number.NaN))
        < 0.01 || row.market.regime === 'RANGE_BOUND' && (vix_db5cca(row))
        < 14 && (lower_db5cca(row))
        < 0.35 && (sigma_db5cca(row))
        === 2.5;
}

function leaf_isQqqP4E155RecoveryCurrentBar_db5cca(row: Row): boolean {
    return (row.market.slowSubregime === 'SR01' && (rv_db5cca(row))
        >= 0.8 && (finite_db5cca(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY))
        >= 0.1);
}

function leaf_isQqqP4E160RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentVix = vix_db5cca(row);
    const currentSma = finite_db5cca(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
    const currentLower = lower_db5cca(row);
    const selectedSigma = sigma_db5cca(row);
    const extendedLowVixQuality = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && currentVix < 12 && currentLower >= 0.3 && currentLower < 0.35 && selectedSigma === 2.5 && !(currentSma >= 0.11 && currentRv >= 0.3);
    return extendedLowVixQuality;
}

function leaf_isQqqP4E164RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const currentLower = lower_db5cca(row);
    const extendedLowRv = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && currentRv < 0.3 && currentAdx >= 20 && currentAdx < 25 && currentLower < 0.4;
    return extendedLowRv;
}

function leaf_isQqqP4E170RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
    const currentAdx = adx_db5cca(row);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.POSITIVE_INFINITY);
    const currentLower = lower_db5cca(row);
    const broadBullSr02 = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentExtension >= 0 && currentExtension < 1.5 && currentLower >= 0.35 && currentLower < 0.39 && sigma_db5cca(row) === 2.5;
    const trendImpulseMismatch = currentAdx >= 30 && currentRoc5 < -0.005 && currentExtension >= 0.5;
    return broadBullSr02 && !trendImpulseMismatch;
}

function leaf_isQqqP4E173RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentSma = finite_db5cca(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
    const rangeMediumRv = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && currentRv >= 0.3 && currentRv < 0.4 && currentSma >= 0 && currentSma < 0.05 && currentExtension >= -1.5;
    return rangeMediumRv;
}

function leaf_isQqqP4E176RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const currentVix = vix_db5cca(row);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY);
    const sidewaysHighRvQuality = row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && currentRv >= 1 && currentAdx >= 40 && currentAdx < 60 && currentVix < 33 && currentExtension < 1;
    return sidewaysHighRvQuality;
}

function leaf_isQqqP4E180RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentSma = finite_db5cca(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
    const currentAdx = adx_db5cca(row);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.POSITIVE_INFINITY);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
    const bullMediumRvQuality = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentRv >= 0.3 && currentRv < 0.4 && currentSma >= 0 && currentSma < 0.05 && !(currentAdx >= 30 && currentRoc5 > 0.01 && currentExtension >= 1);
    return bullMediumRvQuality;
}

function leaf_isQqqP4E183RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentRv = rv_db5cca(row);
    const currentSma = finite_db5cca(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
    const currentVix = vix_db5cca(row);
    const extendedSr01Quality = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR01' && currentRv >= 0.4 && currentRv < 0.5 && currentSma >= 0.05 && currentSma < 0.1 && currentVix < 15;
    return extendedSr01Quality;
}

function leaf_isQqqP4E186RecoveryCurrentBar_db5cca(row: Row): boolean {
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentLower = lower_db5cca(row);
    const currentVix = vix_db5cca(row);
    const rangePositiveQuality = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && currentExtension >= 0 && currentExtension < 1 && currentLower >= 0.35 && currentLower < 0.4 && sigma_db5cca(row) === 2 && currentVix < 15;
    return rangePositiveQuality;
}

function leaf_isQqqP4E191RecoveryCurrentBar_db5cca(row: Row): boolean {
    return (row.market.regime === 'SIDEWAYS' && (finite_db5cca(row.market.roc5, Number.NaN))
        >= -0.02 && (finite_db5cca(row.market.roc5, Number.NaN))
        < 0 && (finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        < 0.5);
}

function leaf_isQqqP4E196RecoveryCurrentBar_db5cca(row: Row): boolean {
    return (`${row.market.regime ?? 'NA'}/${row.market.slowSubregime ?? 'NA'}`)
        === 'SIDEWAYS/SR01' && (vix_db5cca(row))
        >= 26 || (`${(row.history.length >= 2 ? row.history[row.history.length - 2] : undefined)
        ?.regime ?? 'NA'}/${(row.history.length >= 2 ? row.history[row.history.length - 2] : undefined)
        ?.slowSubregime ?? 'NA'}`)
        === 'BULL/SR02' && (`${row.market.regime ?? 'NA'}/${row.market.slowSubregime ?? 'NA'}`)
        === 'BULL/SR02' && (finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        >= 2 || (`${(row.history.length >= 2 ? row.history[row.history.length - 2] : undefined)
        ?.regime ?? 'NA'}/${(row.history.length >= 2 ? row.history[row.history.length - 2] : undefined)
        ?.slowSubregime ?? 'NA'}`)
        === 'RANGE_BOUND/SR02' && rv_db5cca(row) < 0.3 && (finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        >= -1.3;
}

function leaf_isQqqP4E199RecoveryCurrentBar_db5cca(row: Row): boolean {
    return (row.market.regime === 'RANGE_BOUND' && (lower_db5cca(row))
        < 0.35 && ((sigma_db5cca(row))
        ?? Number.NaN) >= 2 && (finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        <= 0);
}

function leaf_isQqqP4E202RecoveryCurrentBar_db5cca(row: Row): boolean {
    const extendedAdxPocket = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && adx_db5cca(row) >= 16 && adx_db5cca(row) < 20;
    const lowRvHighSmaRisk = rv_db5cca(row) < 0.31 && finite_db5cca(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY) >= 0.11;
    return extendedAdxPocket && !lowRvHighSmaRisk;
}

function leaf_isQqqP4E208RecoveryCurrentBar_db5cca(row: Row): boolean { return row.market.regime === 'RISK_ON_WEAKENING' && lower_db5cca(row) < 0.45 && sigma_db5cca(row) === 2.5 || row.market.regime === 'BULL' && adx_db5cca(row) >= 40; }

function leaf_isQqqP4E216RecoveryCurrentBar_db5cca(row: Row): boolean {
    const rangeAdxExtension = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && adx_db5cca(row) >= 12 && adx_db5cca(row) < 16 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= 1 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < 1.5;
    return rangeAdxExtension;
}

function leaf_isQqqP4E217RecoveryCurrentBar_db5cca(row: Row): boolean {
    const rangeRvExtension = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && rv_db5cca(row) >= 0.4 && rv_db5cca(row) < 0.5 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= -1.5 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < -1;
    return rangeRvExtension;
}

function leaf_isQqqP4E221RecoveryCurrentBar_db5cca(row: Row): boolean { return row.market.regime === 'SIDEWAYS' && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= -1 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < 0 && rv_db5cca(row) < 0.8 || row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && adx_db5cca(row) >= 16 && rv_db5cca(row) >= 0.5; }

function leaf_isQqqP4E225RecoveryCurrentBar_db5cca(row: Row): boolean {
    return (row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && adx_db5cca(row) < 20 && (finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        >= -1.5);
}

function leaf_isQqqP4E227RecoveryCurrentBar_db5cca(row: Row): boolean {
    return row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && (sigma_db5cca(row))
        === 1.5 && (finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        < 3 || (lower_db5cca(row))
        < 0.35 && (sigma_db5cca(row))
        === 2 && (finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        >= 0 && (finite_db5cca(row.market.priceExtensionAtr, Number.NaN))
        < 0.5;
}

function leaf_isQqqP4E230RecoveryCurrentBar_db5cca(row: Row): boolean {
    const previous = row.history.length >= 2 ? row.history[row.history.length - 2] : undefined;
    const sameState = (regime: string, slowSubregime: string) => previous?.regime === regime && previous?.slowSubregime === slowSubregime && row.market.regime === regime && row.market.slowSubregime === slowSubregime;
    const currentLower = lower_db5cca(row);
    const currentSigma = sigma_db5cca(row);
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const bullContractTransition = sameState('BULL', 'SR02') && currentLower >= 0.3 && currentLower < 0.35 && currentSigma === 1.5 && currentExtension >= 1 && currentExtension < 1.5;
    const rangeContractTransition = sameState('RANGE_BOUND', 'SR02') && currentLower >= 0.35 && currentLower < 0.4 && currentSigma === 2 && currentExtension >= -1 && currentExtension < 0;
    return bullContractTransition || rangeContractTransition;
}

function leaf_isQqqP4E233RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    if (stableRun < 3)
        return false;
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.NaN);
    const currentAdx = adx_db5cca(row);
    const sideways = row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && currentExtension >= -1 && currentExtension < 0 && (currentRoc5 >= 0 && currentRoc5 < 0.03 || currentAdx >= 40 && currentAdx < 60);
    const range = row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && currentExtension >= 1.5 && currentExtension < 2 && currentRoc5 >= 0 && currentRoc5 < 0.01;
    const bull = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentExtension >= 1 && currentExtension < 1.5 && currentRoc5 >= 0.02 && currentRoc5 < 0.03;
    return sideways || range || bull;
}

function leaf_isQqqP4E236RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentRv = rv_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const bullDeep = stableRun >= 4 && row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentAdx >= 30 && currentAdx < 40 && currentRv >= 0.4 && currentRv < 0.5;
    const sidewaysDeep = stableRun >= 4 && row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && currentAdx >= 30 && currentAdx < 40 && currentExtension >= -1.5 && currentExtension < -1;
    const rangeDeep = stableRun >= 4 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && lower_db5cca(row) >= 0.45 && lower_db5cca(row) < 0.49 && sigma_db5cca(row) === 2.5 && currentExtension >= 0 && currentExtension < 0.5;
    return bullDeep || sidewaysDeep || rangeDeep;
}

function leaf_isQqqP4E238RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.NaN);
    const currentRv = rv_db5cca(row);
    const currentAdx = adx_db5cca(row);
    const bull = stableRun >= 5 && row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentExtension >= 0.5 && currentExtension < 1 && (currentRoc5 >= -0.02 && currentRoc5 < 0 || lower_db5cca(row) >= 0.4 && lower_db5cca(row) < 0.45 && sigma_db5cca(row) === 2.5);
    const range = stableRun >= 5 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && lower_db5cca(row) >= 0.4 && lower_db5cca(row) < 0.45 && sigma_db5cca(row) === 2 && currentRv >= 0.5 && currentRv < 0.67;
    const extended = stableRun >= 5 && row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && currentAdx >= 25 && currentAdx < 30 && currentRv >= 0.4 && currentRv < 0.5;
    return bull || range || extended;
}

function leaf_isQqqP4E241RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const currentExtension = finite_db5cca(row.market.priceExtensionAtr, Number.NaN);
    const currentRoc5 = finite_db5cca(row.market.roc5, Number.NaN);
    const currentRv = rv_db5cca(row);
    const bull = stableRun >= 5 && row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && currentRoc5 >= -0.02 && currentRoc5 < 0 && currentExtension >= -1 && currentExtension < 0;
    const range = stableRun >= 5 && row.market.regime === 'RANGE_BOUND' && (row.market.slowSubregime === 'SR02' && lower_db5cca(row) >= 0.35 && lower_db5cca(row) < 0.4 && sigma_db5cca(row) === 2.5 && currentRv >= 0.3 && currentRv < 0.4 || row.market.slowSubregime === 'SR01' && vix_db5cca(row) < 15);
    return bull || range;
}

function leaf_isQqqP4E245RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const extended = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= 2 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < 3 && (stableRun >= 5 && adx_db5cca(row) >= 40 && adx_db5cca(row) < 60 || stableRun >= 3 && finite_db5cca(row.market.roc5, Number.NaN) >= 0.01 && finite_db5cca(row.market.roc5, Number.NaN) < 0.02 && rv_db5cca(row) >= 0.38);
    return extended;
}

function leaf_isQqqP4E248RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const lowVolExtended = stableRun >= 5 && row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && rv_db5cca(row) < 0.3 && vix_db5cca(row) < 12;
    return lowVolExtended;
}

function leaf_isQqqP4E252RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const rangePocket = stableRun >= 5 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && adx_db5cca(row) >= 10 && adx_db5cca(row) < 12 && finite_db5cca(row.market.roc5, Number.NaN) >= -0.02 && finite_db5cca(row.market.roc5, Number.NaN) < 0;
    return rangePocket;
}

function leaf_isQqqP4E255RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const extendedPocket = stableRun >= 7 && row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && lower_db5cca(row) >= 0.3 && lower_db5cca(row) < 0.35 && sigma_db5cca(row) === 2.5 && rv_db5cca(row) >= 0.25 && rv_db5cca(row) < 0.3;
    return extendedPocket;
}

function leaf_isQqqP4E270RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const selectedLower = lower_db5cca(row);
    const selectedSigma = sigma_db5cca(row);
    const extendedTrend = stableRun >= 7 && row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && adx_db5cca(row) >= 30 && adx_db5cca(row) < 40 && finite_db5cca(row.market.roc20, Number.NaN) >= 0.02 && finite_db5cca(row.market.roc20, Number.NaN) < 0.05 && selectedSigma === 2.5;
    const rangeQuality = finite_db5cca(row.market.rsi14, Number.NEGATIVE_INFINITY) >= 60 || finite_db5cca(row.market.weakeningSignalCount, Number.NEGATIVE_INFINITY) >= 1;
    const rangeRecovery = stableRun >= 3 && stableRun < 10 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 12 && vix_db5cca(row) < 15 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= 1 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < 1.5 && selectedLower >= 0.3 && selectedLower < 0.42 && (selectedSigma === 2 || selectedSigma === 2.5) && rangeQuality;
    return extendedTrend || rangeRecovery;
}

function leaf_isQqqP4E278RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const rangeContinuation = stableRun >= 5 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && vix_db5cca(row) >= 12 && vix_db5cca(row) < 15 && finite_db5cca(row.market.roc5, Number.NaN) >= 0 && finite_db5cca(row.market.roc5, Number.NaN) < 0.01;
    const bullMediumLowRv = stableRun >= 3 && row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && rv_db5cca(row) >= 0.38 && rv_db5cca(row) < 0.4;
    return rangeContinuation || bullMediumLowRv;
}

function leaf_isQqqP4E283RecoveryCurrentBar_db5cca(row: Row): boolean {
    const stableRun = memoValue(row, 'stable-run', () => trailingStateRun(row.history, row.market));
    const extendedLowRv = stableRun < 7 && row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && rv_db5cca(row) >= 0 && rv_db5cca(row) < 0.25 && !(adx_db5cca(row) >= 29 && adx_db5cca(row) < 30);
    const rangeShortSigma15 = stableRun < 3 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= 1.5 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < 2 && sigma_db5cca(row) === 1.5;
    const rangeStableExtension = stableRun >= 7 && row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) >= -1 && finite_db5cca(row.market.priceExtensionAtr, Number.NaN) < -0.2;
    return extendedLowRv || rangeShortSigma15 || rangeStableExtension;
}

function leaf_isQqqP4E286RecoveryCurrentBar_db5cca(row: Row): boolean {
    return (`${row.market.regime}/${row.market.slowSubregime}`)
        === 'RANGE_BOUND/SR01' && vix_db5cca(row) < 17 && finite_db5cca(row.market.rsi14, Number.NaN) < 45 || (`${row.market.regime}/${row.market.slowSubregime}`)
        === 'RISK_ON_EXTENDED/SR02' && rv_db5cca(row) >= 0.3 && rv_db5cca(row) < 0.38 && adx_db5cca(row) < 16;
}

function leaf_isQqqP4E290RecoveryCurrentBar_db5cca(row: Row): boolean {
    return (`${row.market.regime}/${row.market.slowSubregime}`)
        === 'BULL/SR02' && ((lower_db5cca(row))
        >= 0.42 && (rv_db5cca(row))
        < 0.38 && (rv_db5cca(row))
        >= 0.3 || (rv_db5cca(row))
        < 0.3 && (rv_db5cca(row))
        >= 0.25) || (`${row.market.regime}/${row.market.slowSubregime}`)
        === 'RANGE_BOUND/SR02' && finite_db5cca(row.market.rsi14, Number.NaN) >= 55 && vix_db5cca(row) >= 17;
}

function isQqqP4E290RecoveryCurrentBar_db5cca(row: Row): boolean { return [isQqqP4E152RecoveryCurrentBar_db5cca, leaf_isQqqP4E153RecoveryCurrentBar_db5cca, leaf_isQqqP4E155RecoveryCurrentBar_db5cca, leaf_isQqqP4E160RecoveryCurrentBar_db5cca, leaf_isQqqP4E164RecoveryCurrentBar_db5cca, leaf_isQqqP4E170RecoveryCurrentBar_db5cca, leaf_isQqqP4E173RecoveryCurrentBar_db5cca, leaf_isQqqP4E176RecoveryCurrentBar_db5cca, leaf_isQqqP4E180RecoveryCurrentBar_db5cca, leaf_isQqqP4E183RecoveryCurrentBar_db5cca, leaf_isQqqP4E186RecoveryCurrentBar_db5cca, leaf_isQqqP4E191RecoveryCurrentBar_db5cca, leaf_isQqqP4E196RecoveryCurrentBar_db5cca, leaf_isQqqP4E199RecoveryCurrentBar_db5cca, leaf_isQqqP4E202RecoveryCurrentBar_db5cca, leaf_isQqqP4E208RecoveryCurrentBar_db5cca, leaf_isQqqP4E216RecoveryCurrentBar_db5cca, leaf_isQqqP4E217RecoveryCurrentBar_db5cca, leaf_isQqqP4E221RecoveryCurrentBar_db5cca, leaf_isQqqP4E225RecoveryCurrentBar_db5cca, leaf_isQqqP4E227RecoveryCurrentBar_db5cca, leaf_isQqqP4E230RecoveryCurrentBar_db5cca, leaf_isQqqP4E233RecoveryCurrentBar_db5cca, leaf_isQqqP4E236RecoveryCurrentBar_db5cca, leaf_isQqqP4E238RecoveryCurrentBar_db5cca, leaf_isQqqP4E241RecoveryCurrentBar_db5cca, leaf_isQqqP4E245RecoveryCurrentBar_db5cca, leaf_isQqqP4E248RecoveryCurrentBar_db5cca, leaf_isQqqP4E252RecoveryCurrentBar_db5cca, leaf_isQqqP4E255RecoveryCurrentBar_db5cca, leaf_isQqqP4E270RecoveryCurrentBar_db5cca, leaf_isQqqP4E278RecoveryCurrentBar_db5cca, leaf_isQqqP4E283RecoveryCurrentBar_db5cca, leaf_isQqqP4E286RecoveryCurrentBar_db5cca, leaf_isQqqP4E290RecoveryCurrentBar_db5cca].some(test => test(row)); }

const e307_6b1c48 = (row: Row) => isQqqP4E290RecoveryCurrentBar_db5cca(row) || f_6b1c48(row.market.adx14) >= 10 && f_6b1c48(row.market.adx14) < 12 && f_6b1c48(row.market.priceExtensionAtr) >= 2 && f_6b1c48(row.market.priceExtensionAtr) < 3 || f_6b1c48(row.market.vixTermStructureSlope) < 0 && f_6b1c48(row.market.distanceToSma20Pct) >= -0.02 && f_6b1c48(row.market.distanceToSma20Pct) < 0;

function isQqqP4E56RecoveryCurrentBar_db5cca(row: Row): boolean {
    return false;
}

function isQqqP4E57RecoveryCurrentBar_db5cca(row: Row): boolean {
    return false;
}

function isQqqP4E58RecoveryCurrentBar_db5cca(row: Row): boolean {
    return false;
}

function isQqqP4E59RecoveryCurrentBar_db5cca(row: Row): boolean {
    return false;
}

const e336_6b1c48 = (row: Row) => { return row.market.regime === 'RISK_ON_WEAKENING' && (f_6b1c48(row.market.range20dPct) < 0.091 && row.market.slowSubregime === 'SR01' && (f_6b1c48(row.market.sma20SlopePct) < -0.006 || f_6b1c48(row.market.vixTermStructureSlope) < 0) || f_6b1c48(row.market.adx14) < 10 && f_6b1c48(row.market.rsi14) < 50) || row.market.slowSubregime === 'SR02' && (f_6b1c48(row.market.roc20) < 0 && f_6b1c48(row.market.vix) < 14 && row.market.regime === 'RANGE_BOUND' || f_6b1c48(row.market.adx14) >= 15 && f_6b1c48(row.market.priceExtensionAtr) < 3 && row.market.regime === 'SIDEWAYS') || f_6b1c48(row.market.vixChange5d) < 0.05 && f_6b1c48(row.market.vixTermStructureSlope) < 3 && row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' || f_6b1c48(row.market.adx14) < 12 && row.market.slowSubregime === 'CURRENT' || f_6b1c48(row.market.range20dPct) < 0.13 && f_6b1c48(row.market.sma20SlopePct) < -0.02; };

const e348_6b1c48 = (row: Row) => e336_6b1c48(row) || row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.vix) < 14 && f_6b1c48(row.market.adx14) < 10 && f_6b1c48(row.market.vixTermStructureSlope) >= 3 || row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.vix) >= 12 && f_6b1c48(row.market.priceExtensionAtr) >= 3 && f_6b1c48(row.market.range20dPct) >= 0.091 || row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.vix) < 14 && f_6b1c48(row.market.adx14) < 20 && f_6b1c48(row.market.priceExtensionAtr) >= 1.5;

const e354Micro_6b1c48 = (row: Row) => { return row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.adx14) >= 30 && f_6b1c48(row.market.roc5) >= 0.02 && f_6b1c48(row.market.rsi14) < 70 || row.market.slowSubregime === 'SR01' && f_6b1c48(row.market.adx14) >= 25 && f_6b1c48(row.market.priceExtensionAtr) >= 2.5 && f_6b1c48(row.market.roc5) < 0.02 || row.market.regime === 'SIDEWAYS' && f_6b1c48(row.market.range20dPct) >= 0.16 && f_6b1c48(row.market.vixChange5d) >= -0.1; };

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
        return adx < 30 && roc5 < 0.0044 && vix < 17 || vix < 12 && roc5 < 0.01 && adx >= 25 || adx >= 40 && drawdown >= 0.01 && vix < 15 || extension < 2.5 && roc5 >= 0.015 && rv20 < 0.3;
    if (stateIs_5585cd(row, 'BULL', 'SR02'))
        return extension < 1 && rsi >= 60 && (adx >= 20 || range20 >= 0.06) || adx >= 25 && extension < 0;
    if (stateIs_5585cd(row, 'RANGE_BOUND', 'SR01'))
        return roc20 >= -0.02 && slope20 < 0 && vix < 17 || adx < 15 && range20 >= 0.06 || roc5 >= 0.01 && roc20 < 0 || adx < 15 && rv20 >= 0.5;
    if (stateIs_5585cd(row, 'SIDEWAYS', 'SR01'))
        return roc20 >= 0.02 && (termSlope < 3 && distance < 0 || extension < 1.5 && vixChange < 0) || vixChange >= 0 && (roc20 >= -0.02 && termSlope < 0 || extension < 0 && distance >= -0.02) || rv20 >= 0.67 && range20 < 0.13 && ma50Slope < 0.02 || adx < 20 && roc5 >= 0.01 && distance < 0 || vix >= 16 && rv20 < 0.5 || adx < 15 && termSlope < 3;
    if (stateIs_5585cd(row, 'RISK_ON_EXTENDED', 'SR01'))
        return vix < 15 && extension >= 3 && adx < 35;
    if (stateIs_5585cd(row, 'RANGE_BOUND', 'SR02'))
        return adx >= 15 && (slope20 < 0 && vixChange < 0.05 || roc5 >= 0 && drawdown >= 0.01) || roc20 < 0 && vixChange >= 0.05 && rsi >= 50 || extension >= 2 && roc20 >= 0.02;
    if (stateIs_5585cd(row, 'RISK_ON_EXTENDED', 'CURRENT'))
        return true;
    if (stateIs_5585cd(row, 'BULL', 'SR01'))
        return vix < 14 && extension >= 0;
    if (stateIs_5585cd(row, 'RISK_ON_WEAKENING', 'SR02'))
        return roc5 < 0 && rsi >= 50;
    if (stateIs_5585cd(row, 'RISK_ON_WEAKENING', 'SR01'))
        return adx >= 25 && vixChange < 0;
    if (stateIs_5585cd(row, 'RISK_ON_WEAKENING', 'CURRENT') || stateIs_5585cd(row, 'SIDEWAYS', 'SR02'))
        return range20 >= 0.06 && slope20 < 0;
    if (stateIs_5585cd(row, 'BULL', 'CURRENT'))
        return adx >= 15;
    return false;
};

const previous_5585cd = (row: Row) => row.history.length >= 2 ? row.history[row.history.length - 2] : undefined;

const p5e213E68Grouped_5585cd = (row: Row) => {
    const prev = previous_5585cd(row);
    if (stateIs_5585cd(row, 'RISK_ON_EXTENDED', 'SR02'))
        return prev?.regime === 'BULL' && prev?.slowSubregime === 'SR01' || prev?.regime === 'BULL' && prev?.slowSubregime === 'SR02' && f_6b1c48(row.market.adx14) < 12 || prev?.regime === 'RISK_ON_EXTENDED' && prev?.slowSubregime === 'CURRENT' && f_6b1c48(row.market.vix) < 14;
    if (stateIs_5585cd(row, 'RANGE_BOUND', 'SR02'))
        return prev?.regime === 'RANGE_BOUND' && prev?.slowSubregime === 'SR01' && f_6b1c48(row.market.adx14) < 12;
    return false;
};

const sequence_5585cd = (row: Row) => memoValue(row, 'last-three', () => lastThreeStateSequence(row.history, row.market));

const p5e213E71_5585cd = (row: Row) => sequence_5585cd(row) === 'RISK_ON_EXTENDED/CURRENT -> RISK_ON_EXTENDED/SR02 -> RISK_ON_EXTENDED/SR02' || sequence_5585cd(row) === 'RANGE_BOUND/SR01 -> RANGE_BOUND/SR01 -> RISK_ON_WEAKENING/SR01';

const p5e213E74Grouped_5585cd = (row: Row) => {
    const seq = sequence_5585cd(row);
    const adx12 = f_6b1c48(row.market.adx14) < 12;
    const vixChangeUp = f_6b1c48(row.market.vixChange5d) >= 0;
    if (seq === 'RANGE_BOUND/SR02 -> BULL/SR02 -> RANGE_BOUND/SR02')
        return f_6b1c48(row.market.rsi14) >= 50 || adx12;
    if (seq === 'BULL/SR01 -> BULL/SR01 -> BULL/SR02')
        return vixChangeUp;
    if (seq === 'BULL/SR01 -> BULL/SR01 -> RISK_ON_EXTENDED/SR01')
        return f_6b1c48(row.market.tqqqRealisedVol20d) >= 0.5;
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
    return seq === 'BULL/SR02 -> BULL/SR02 -> RISK_ON_EXTENDED/SR02' && f_6b1c48(row.market.priceExtensionAtr) >= 2 && f_6b1c48(row.market.vixChange5d) < 0 || transition && f_6b1c48(row.market.adx14) < 12 && f_6b1c48(row.market.vix) < 14;
};

const rangePocket_8dbc6d = (row: Row) => row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && f_6b1c48(row.market.adx14) < 12 && f_6b1c48(row.market.tqqqRealisedVol20d) < 0.5 && f_6b1c48(row.market.range20dPct) >= 0.06;

const p5e213E94_5585cd = (row: Row) => rangePocket_8dbc6d(row);

const p6CandidateA = candidateAState_db5cca;

const p6CurrentArm = currentArmEquivalent_db5cca;

const p6E307 = e307_6b1c48;

const p6E348 = e348_6b1c48;

const p6E354 = e354Micro_6b1c48;

const p6e220E65Grouped_bd991b = (row: Row) => {
    if (row.market.regime !== 'RANGE_BOUND' || row.market.slowSubregime !== 'SR01')
        return p5e213E65Grouped_5585cd(row);
    const roc20 = f_6b1c48(row.market.roc20);
    const slope20 = f_6b1c48(row.market.sma20SlopePct);
    const vix = f_6b1c48(row.market.vix);
    const adx = f_6b1c48(row.market.adx14);
    const range20 = f_6b1c48(row.market.range20dPct);
    const roc5 = f_6b1c48(row.market.roc5);
    return roc20 >= -0.02 && slope20 < 0 && vix < 17 || adx < 15 && range20 >= 0.06 || roc5 >= 0.01 && roc20 < 0;
};

const p6e220Admission_bd991b = (row: Row) => p6e220E65Grouped_bd991b(row) || p5e213E68Grouped_5585cd(row) || p5e213E71_5585cd(row) || p5e213E74Grouped_5585cd(row) || p5e213E77_5585cd(row) || p5e213E86_5585cd(row) || p5e213E87Grouped_5585cd(row) || p5e213E94_5585cd(row);

const p6ExtraAdmission = p6e220Admission_bd991b;

export const admissionRiskFacts = { p6ContextRow: p6ContextRow, p6CurrentBlock: p6CurrentBlock, p6PriceSmaBlock: p6PriceSmaBlock, p6P1Block: p6P1Block, p6FinalReject: p6FinalReject, p6ProtectionBypass: p6ProtectionBypass_riskRole, p6RejectQualityGuard: p6RejectQualityGuard_riskRole, isQqqP4E54FlatMergedCurrentBarReject_db5cca: isQqqP4E54FlatMergedCurrentBarReject_db5cca, isQqqP4E56RecoveryCurrentBar_db5cca: isQqqP4E56RecoveryCurrentBar_db5cca_riskRole, isQqqP4E57RecoveryCurrentBar_db5cca: isQqqP4E57RecoveryCurrentBar_db5cca_riskRole, isQqqP4E58RecoveryCurrentBar_db5cca: isQqqP4E58RecoveryCurrentBar_db5cca_riskRole, isQqqP4E59RecoveryCurrentBar_db5cca: isQqqP4E59RecoveryCurrentBar_db5cca_riskRole, isQqqP4E61RecoveryCurrentBar_db5cca: isQqqP4E61RecoveryCurrentBar_db5cca, isQqqP4E62RecoveryCurrentBar_db5cca: isQqqP4E62RecoveryCurrentBar_db5cca, isQqqP4E63RecoveryCurrentBar_db5cca: isQqqP4E63RecoveryCurrentBar_db5cca, isQqqP4E65RecoveryCurrentBar_db5cca: isQqqP4E65RecoveryCurrentBar_db5cca, isQqqP4E66RecoveryCurrentBar_db5cca: isQqqP4E66RecoveryCurrentBar_db5cca, isQqqP4E67RecoveryCurrentBar_db5cca: isQqqP4E67RecoveryCurrentBar_db5cca, isQqqP4E68RecoveryCurrentBar_db5cca: isQqqP4E68RecoveryCurrentBar_db5cca, isQqqP4E104RecoveryCurrentBar_db5cca: isQqqP4E104RecoveryCurrentBar_db5cca };

export const admissionGrantFacts = { p6CurrentArm, p6CandidateA, p6E307, p6E348, p6E354, p6ExtraAdmission };
/** Read-only research alias: original decision functions and legacy role APIs are unchanged. */
export const admissionCoreResearchFacts = Object.freeze({ e307Core: isQqqP4E152RecoveryCurrentBar_db5cca, e307Leaves: Object.freeze([leaf_isQqqP4E153RecoveryCurrentBar_db5cca, leaf_isQqqP4E155RecoveryCurrentBar_db5cca, leaf_isQqqP4E160RecoveryCurrentBar_db5cca, leaf_isQqqP4E164RecoveryCurrentBar_db5cca, leaf_isQqqP4E170RecoveryCurrentBar_db5cca, leaf_isQqqP4E173RecoveryCurrentBar_db5cca, leaf_isQqqP4E176RecoveryCurrentBar_db5cca, leaf_isQqqP4E180RecoveryCurrentBar_db5cca, leaf_isQqqP4E183RecoveryCurrentBar_db5cca, leaf_isQqqP4E186RecoveryCurrentBar_db5cca, leaf_isQqqP4E191RecoveryCurrentBar_db5cca, leaf_isQqqP4E196RecoveryCurrentBar_db5cca, leaf_isQqqP4E199RecoveryCurrentBar_db5cca, leaf_isQqqP4E202RecoveryCurrentBar_db5cca, leaf_isQqqP4E208RecoveryCurrentBar_db5cca, leaf_isQqqP4E216RecoveryCurrentBar_db5cca, leaf_isQqqP4E217RecoveryCurrentBar_db5cca, leaf_isQqqP4E221RecoveryCurrentBar_db5cca, leaf_isQqqP4E225RecoveryCurrentBar_db5cca, leaf_isQqqP4E227RecoveryCurrentBar_db5cca, leaf_isQqqP4E230RecoveryCurrentBar_db5cca, leaf_isQqqP4E233RecoveryCurrentBar_db5cca, leaf_isQqqP4E236RecoveryCurrentBar_db5cca, leaf_isQqqP4E238RecoveryCurrentBar_db5cca, leaf_isQqqP4E241RecoveryCurrentBar_db5cca, leaf_isQqqP4E245RecoveryCurrentBar_db5cca, leaf_isQqqP4E248RecoveryCurrentBar_db5cca, leaf_isQqqP4E252RecoveryCurrentBar_db5cca, leaf_isQqqP4E255RecoveryCurrentBar_db5cca, leaf_isQqqP4E270RecoveryCurrentBar_db5cca, leaf_isQqqP4E278RecoveryCurrentBar_db5cca, leaf_isQqqP4E283RecoveryCurrentBar_db5cca, leaf_isQqqP4E286RecoveryCurrentBar_db5cca, leaf_isQqqP4E290RecoveryCurrentBar_db5cca]) });

/** Read-only extra-grant grouping for structural ablations; original byte prefix unchanged. */
export const admissionExtraResearchFacts = Object.freeze({ groups: Object.freeze([p6e220E65Grouped_bd991b, p5e213E68Grouped_5585cd, p5e213E71_5585cd, p5e213E74Grouped_5585cd, p5e213E77_5585cd, p5e213E86_5585cd, p5e213E87Grouped_5585cd, p5e213E94_5585cd]) });

/** Read-only E348 base reference for whole-block structural rollback. */
export const admissionDeepResearchFacts = Object.freeze({ e348Core: e336_6b1c48 });
