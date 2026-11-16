/** Fixed R2465 further simplification; fresh callback and financial ledger equivalence required. */
import { buildQuoteOnlyRRescue } from '../r-quote-only-rescue-v1';
;
import { assertFixedStrategyParams, freezeStrategyData, type BarStrategyModule, type StrategyObject, type StrategyIntent, type StrategySnapshot } from '../strategy-module-v2';
import type { OptionChain } from '../../engines/leveraged-overlay/types/input';
import type { PutSpreadBounds } from '../bounded-put-spread-selection-v1';
import { selectAsymmetricPutSpread } from '../asymmetric-put-spread-selection-v1';
import { resolveOptionQuote } from '../../optionQuote';
import type { PutCreditSpreadOpen } from '../put-spread-kernel-v6';
import type { PcsAnalyticalProbe } from '../qqq-pcs-analytics-v2';
import { resolveVolatilityCoordinates } from '../market-coordinates-v3';
import { projectNativeMarketFacts } from '../native-market-facts-v7';
import { settledFeedbackPnl } from '../settlement-observations-v3';
import { stressOnlyPcsSelectionProfile } from '../pcs-selection-v6';
import { isPcsV12GateBlocked } from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';
import { isCallCreditSpreadPreCrisis } from '../put-spread-kernel-v6';
import { R9_MAIN_PCS_CONTRACT, r9MainPcsStress, selectR9MainPcs } from './r9-e226-main-pcs-v3';
import { R9_E226_SOURCE_CONTRACT } from './r9-e226-source-contract-v1';
import { createAdmissionTrace } from '../strategy-admission-v1';
import { R9_E226_PARAMS, r9E226DualMainQuality, r9E226SourceAdmission, r9E226LowRvBlocked, r9E226ProposalPriority, type R9E226Market } from './r9-e226-policy-v5';
export const R2465_CLOSING_COMMISSION_MODE = 'account-default-v1' as const;
;
const mandatoryUpstream = ['dataQuality', 'regime', 'hardRisk', 'intradayGate'];
export function r2465MandatoryBlocked(upstream: Readonly<StrategyObject>) {
    return Object.values(upstream).some(value => value === 'ERROR') || mandatoryUpstream.some(key => upstream[key] === 'BLOCK');
}
export function r2465CoverageAfterMandatoryCheck(input: {
    upstream: Readonly<StrategyObject>;
    regime: string;
    crisisPhase: string;
    primary?: number;
    primary3m?: number;
    macroVix?: number;
    macroVix3m?: number;
}) {
    if (!['PASS', 'WARN'].includes(String(input.upstream.dataQuality)))
        return false;
    if (input.regime === 'CRISIS' || ['CONFIRMED', 'PENDING'].includes(input.crisisPhase))
        return false;
    if (![input.primary, input.primary3m, input.macroVix, input.macroVix3m].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0))
        return false;
    return input.primary3m! > input.primary!;
}
export function r2465MaturityDeltaBeforeSafetyCaps(bounds: PutSpreadBounds, vol?: number) {
    if (!Number.isFinite(vol) || vol! <= 0)
        return undefined;
    const active = Math.max(.03, .15 * Math.pow(vol! / 35, 1.375));
    return { ...bounds, maximumShortDelta: active, targetShortDelta: active };
}
export function r2465SelectMaturityFallback(chain: OptionChain, asOf: string, bounds: PutSpreadBounds, protectionQuoteSpread: number) {
    for (const targetDte of [63, 56, 42, 35]) {
        const contract = selectAsymmetricPutSpread(chain, asOf, targetDte, bounds, protectionQuoteSpread);
        if (contract)
            return { contract, targetDte };
    }
    return undefined;
}
function r2465ValidProtectionPut(p: OptionChain['expirations'][number]['puts'][number]) { return Number.isFinite(p.strike) && p.strike > 0 && Number.isFinite(p.delta) && p.delta <= 0 && Number.isFinite(p.openInterest) && p.openInterest > 0 && Number.isFinite(p.volume) && p.volume >= 0; }
function r2465ProtectionReference(chain: OptionChain, reference: PutCreditSpreadOpen) {
    const stamp = Date.parse(chain.timestamp);
    if (!Number.isFinite(stamp) || !reference.expiry || reference.expiry <= chain.timestamp.slice(0, 10) || !Number.isFinite(reference.credit) || reference.credit! <= 0)
        return undefined;
    const expiry = chain.expirations.find(e => e.date === reference.expiry), short = expiry?.puts.find(p => p.strike === reference.shortStrike && r2465ValidProtectionPut(p)), quote = short ? resolveOptionQuote(short, .5, stamp / 1000) : undefined;
    if (!short || quote?.source !== 'market')
        return undefined;
    return { stamp, expiry, short, quote };
}
export function r2465WidenProtection(chain: OptionChain, reference: PutCreditSpreadOpen, maximumWidth: number, fee: number): PutCreditSpreadOpen | undefined {
    if (!Number.isFinite(maximumWidth) || maximumWidth <= 0 || maximumWidth > 200 || !Number.isFinite(fee) || fee < 0 || reference.quantity !== 1)
        throw Error('Invalid single-spread protection budget');
    const observed = r2465ProtectionReference(chain, reference);
    if (!observed)
        return undefined;
    const { stamp, expiry, short, quote: shortQuote } = observed;
    const choices = (expiry?.puts ?? []).flatMap(long => {
        if (!r2465ValidProtectionPut(long) || long.strike >= reference.longStrike || Math.abs(long.delta) > Math.abs(short.delta))
            return [];
        const width = short.strike - long.strike, quote = resolveOptionQuote(long, 2, stamp / 1000);
        if (width > maximumWidth || quote?.source !== 'market')
            return [];
        const credit = shortQuote.sell - quote.buy, maxLoss = width * 100 - credit * 100;
        return credit > reference.credit! && credit * 100 - 2 * fee >= 1 && maxLoss > 0 ? [{ long, credit, maxLoss, width }] : [];
    }).sort((a, b) => b.credit - a.credit || a.width - b.width);
    const best = choices[0];
    return best ? { ...reference, longStrike: best.long.strike, credit: best.credit, maxLoss: best.maxLoss, quantity: 1, pairSearchUsed: true } : undefined;
}
;
function r2465RotationMemory(value: unknown): StrategyObject {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Missing rotation memory');
    for (const held of Object.values(value)) {
        if (!held || typeof held !== 'object' || Array.isArray(held) || Object.keys(held).length !== 1 || typeof (held as StrategyObject).release !== 'boolean')
            throw Error('Fresh release-only state required; legacy peak/harvest state unsupported');
    }
    return value as StrategyObject;
}
export function r2465RotationExits(snapshot: Readonly<StrategySnapshot>, priorMemory: Readonly<StrategyObject>, input: {
    opportunity?: {
        credit: number;
        margin: number;
        days: number;
    };
}) {
    const ownedMemory = r2465RotationMemory(priorMemory);
    if (snapshot.market.sampleTerminal === true)
        return { intents: [] as StrategyIntent[], memory: { ...ownedMemory } };
    const fee = Number((snapshot.market.executionCapabilities as StrategyObject | undefined)?.commissionPerContract);
    if (!Number.isFinite(fee) || fee < 0)
        throw Error('Adaptive exits require the actual closing commission');
    const current = Date.parse(snapshot.asOf), memory: StrategyObject = { ...ownedMemory };
    if (!Number.isFinite(current))
        throw Error('Invalid adaptive as-of');
    const intents = snapshot.positions.map<StrategyIntent>(position => {
        const id = String(position.id), credit = Number(position.creditReceived), mark = Number(position.markPnl), opened = Date.parse(String(position.openDate)), expiry = Date.parse(String(position.expiry));
        if (!(credit > 0) || !Number.isFinite(mark) || !Number.isFinite(opened) || !Number.isFinite(expiry) || expiry <= opened || opened > current || position.quantity !== 1 || position.multiplier !== 1)
            throw Error('Invalid adaptive position');
        const held = priorMemory[id] as StrategyObject | undefined;
        if (!held || typeof held.release !== 'boolean')
            throw Error('Missing adaptive position memory');
        const net = mark - 2 * fee, daysLeft = Math.max(0, (expiry - current) / 86400000);
        const maturity = id.startsWith('r9-maturity:'), coverage = id.startsWith('r9-coverage:'), base = maturity ? 0.9 : 0.4;
        let release = held.release;
        const applies = (!maturity && !coverage);
        {
            const fresh = input.opportunity, margin = Number(position.margin);
            if (!Number.isFinite(margin) || margin <= 0)
                throw Error('Rotation requires observed position margin');
            const oldYield = Math.max(0, credit - net) / margin / Math.max(7, daysLeft);
            const newYield = fresh && [fresh.credit, fresh.margin, fresh.days].every(Number.isFinite) && fresh.credit > 0 && fresh.margin > 0 && fresh.days > 0 ? fresh.credit / fresh.margin / fresh.days : 0;
            if (net >= Math.max(.5, credit * (0.2)) && newYield > oldYield * (1.5)) {
                release = true;
            }
        }
        memory[id] = { release };
        return { kind: 'close-position', key: `r10-profit:${id}:${snapshot.asOf}`, positionId: id, reason: (!applies || !release) ? "r10-net-profit-target" : "r10-adaptive-profit-release",
            minimumUnweightedPnl: release ? 0.5 : credit * base };
    });
    return { intents, memory };
}
;
;
export function r2465DynamicGeometry(input: {
    spot: number;
    vol?: number;
    realizedVol: number;
    roc5?: number;
    roc20?: number;
    term?: number;
    heldCount: number;
}) {
    if (!Number.isFinite(input.heldCount) || !Number.isInteger(input.heldCount) || input.heldCount < 0)
        throw Error("Invalid dynamic geometry inputs");
    const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
    if (![input.spot, input.vol, input.realizedVol, input.roc5, input.roc20, input.term].every(v => typeof v === "number" && Number.isFinite(v)) || input.spot <= 0 || input.vol! <= 0 || input.realizedVol < 0)
        return { delta: 0.1, width: 10, dte: 70, quality: -1, pressure: 0 };
    const quality = clamp(0.5 * Math.tanh(input.roc20! / 0.06) + 0.5 * Math.tanh(input.roc5! / 0.025) - 0.5 * Math.max(0, input.realizedVol / (input.vol! / 100) - 1), -1, 1), pressure = clamp((input.heldCount - 6) / 12, 0, 1), delta = 0.2 + 0.05 * quality;
    let width = 20 * (1 + 0.25 * quality), dte = 70;
    if (input.vol! >= 25 && quality >= 0.35)
        dte = 63;
    if (input.vol! <= 18 && quality >= 0.35)
        dte = 75;
    width = width * (1 - 0.2 * pressure);
    return { delta, width, dte, quality, pressure };
}
export function r2465MaturityWidenScore(reference: PutCreditSpreadOpen, wider: PutCreditSpreadOpen, asOf: string, quality: number) {
    if (reference.quantity !== 1 || wider.quantity !== 1 || reference.expiry !== wider.expiry || reference.shortStrike !== wider.shortStrike || !(wider.longStrike < reference.longStrike) || ![reference.credit, wider.credit, reference.maxLoss, wider.maxLoss, quality].every(v => typeof v === 'number' && Number.isFinite(v)) || quality < -1 || quality > 1)
        throw Error('Invalid maturity widening quote pair');
    const days = (Date.parse(String(reference.expiry)) - Date.parse(asOf)) / 86400000;
    if (!(days > 0) || !Number.isFinite(days))
        throw Error('Invalid maturity widening as-of');
    const extraCredit = 100 * (Number(wider.credit) - Number(reference.credit)), extraRisk = Number(wider.maxLoss) - Number(reference.maxLoss), positiveQuality = Math.max(0, quality);
    if (extraCredit <= 0 || positiveQuality === 0)
        return 0;
    return extraRisk <= 0 ? Number.MAX_VALUE : extraCredit / extraRisk * 365 / days * positiveQuality;
}
;
export const R2465_OBSERVATION_DTES = [28, 35, 42, 56, 63, 70, 75, 90, 105, 120, 135, 150] as const;
;
export function r2465FloatingGuard(input: {
    core: boolean;
    restored: boolean;
    regime: string;
    roc5?: number;
    roc20?: number;
}): boolean { return input.core && input.restored && (input.regime === 'RANGE_BOUND' && (Number.isFinite(input.roc5) && Number.isFinite(input.roc20) && input.roc5! > 0 && input.roc20! > 0 && input.roc5! < input.roc20! * .25)); }
export function r2465PriceEntryAllowed(input: {
    originalSignal: boolean;
    roc5?: number;
    roc20?: number;
    priceExtensionAtr?: number;
}) {
    const f5 = Number.isFinite(input.roc5), f20 = Number.isFinite(input.roc20);
    return input.originalSignal && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! <= 0 || !input.originalSignal && (f5 && f20 || f5 && input.roc5! <= 0 || f20 && input.roc20! <= 0);
}
export function createR2465Module(): BarStrategyModule {
    const profitFraction = 0.4, targetDelta = 0.2, rescueTargetDte = 70, coverageDelta = 0.075, fallbackMinimumDte = 35, fallbackDelta = 0.15, fallbackProfitFraction = 0.9, minimumSignalCredit = 1, maximumRelativeSpread = 0.5, widthBudget = 30, protectionQuoteSpread = 2, coverageMode = "term-normal", enableMaturityFallback = true, coverageMaximumSpreadWidth = 5, maturityWidenMaximumWidth = 10, maturityWidenScoreFloor = 0.025, maturityMaximumSpreadWidth = 5, fallbackVolPower = 1.375, fallbackDeltaMode = "volatility-scaled", fallbackVolAnchor = 35, coverageTargetDte = 90, coreDeltaMode = "native", maximumSpreadWidth = 20, dynamicPolicy = "balanced", intensity = 1, recycleFraction = 0.2, rotationRatio = 1.5;
    const marketRules = Object.fromEntries(Object.entries(R9_E226_PARAMS).filter(([key]) => !['riskBudgetNav', 'retryRiskCap'].includes(key))) as StrategyObject;
    const defaults: StrategyObject = freezeStrategyData({ simplificationStudy: { "parent": "R2435", "id": "R2465", "mechanism": "remove-core-recovery-narrow", "structuralRemoval": true, "numericCompensation": false, "notAccountBudget": true, "noDateFilter": true }, ...marketRules,
        maturityRiskPolicy: { "parent": "R10.2301", "guard": "coverage-quality", "maximumDelta": 0.1, "maximumWidth": null, "targetDte": null, "takeProfit": null, "notAccountBudget": true, "noDateFilter": true }, floatingAvoidancePolicy: { "parent": "R10.2286", "guard": "range-weak-quarter", "action": "block", "maximumWidth": null, "maximumDelta": null, "targetDte": null, "notAccountBudget": true, "exitAlgorithm": "exact2286", "noDateFilter": true }, recoveryHybridPolicy: { "parent": "R10.1974", "coreNarrowReference": "R10.2268", "maturityCarryReference": "R10.2253", "maturityCarry": 0.15, "coreCarry": 0.225, "coreCreditRetention": 0.65, "notAccountBudget": true, "exitAlgorithm": "exact1974", "notAdditivePnL": true }, quoteCarryAdmission: { threshold: 0.225, scope: 'all', basis: 'signal-credit-per-quoted-maxloss-per-actual-days', exitOpportunity: 'unchanged-before-admission-filter', notAccountBudget: true }, unitQuoteOnlyRescue: true, sourceNavScope: 'legacy-main-observation-only;not-traded-R', RExecutionRetry: 'exact-signal-pair-only', lineage: { parent: 'R10.2301', artifact: 'r2465-standalone-v1', admissionSource: 'R9.E226', comparedWith: 'R10.95/E9230/P11262', researchAlias: 'restore-0', researchFamily: 'numbered-R10.104-descendants', id: 'R2465' }, mainPcs: { ...R9_MAIN_PCS_CONTRACT }, coverageTargetDte, coverageMaximumSpreadWidth, coverageWidthPolicy: 'regular-coverage-only-contract-width; zero-keeps-parent; maturity-and-core-own-geometry; no-book-budget', requiredPutTargetDtes: [...R2465_OBSERVATION_DTES], fallbackDeltaMode, fallbackVolAnchor, fallbackVolPower, maturityMaximumSpreadWidth, maturityWidenMaximumWidth, maturityWidenScoreFloor, maturityWidenPolicy: 'same-short-expiry; additional-signal-credit-over-additional-quoted-max-loss-per-year-times-positive-asof-quality; unobserved-quality-retains-narrow; no-book-budget', maturityWidthPolicy: 'only-fallback-selected-put-protection-width; zero-inherits-parent; no-book-admission-budget', maturityDeltaPolicy: 'clamp-baseDelta-times-observed-primary-vol-over-anchor-to-power; .03-to-.15', recycleFraction, rotationRatio, rotationScope: 'all-roles-as-in-parent-executable-logic', opportunityProxy: 'current-signal-net-credit-per-quoted-max-loss-per-day-versus-held-remaining-credit-per-observed-margin-per-day', exitTiming: 'close-observation-then-next-open-positive-net-profit-limit', exitMemory: 'fresh-release-boolean-only;no-peak-or-legacy-harvest-floor', minimumReleaseNetProfit: .5, dynamicPolicy, intensity, positionPressureScope: 'independent-R-shadow-asof-only', dynamicObservation: 'native-asof-vol-trend-and-own-shadow-positions', coreDeltaMode, maximumSpreadWidth, selectedPolicyMarginLimit: null, marginCapScope: 'none-report-only', protectionPolicy: 'same-signal-short-and-expiry-farther-long-only', protectionSizing: 'one-unit-quote-geometry;no-NAV-budget;exact-saved-pair',
        positionMode: 'independent-one-contract', exitMode: 'daily-next-open-net-profit-limit',
        sampleExecution: 'adapter-owned',
        admission: 'parent-core-plus-term-normal-low-delta-coverage-with-mandatory-data-and-hard-risk-gates', contractSelection: 'nearest-original-delta-feasible-fee-credit-within-delta-and-native-width-bounds',
        closingCommissionMode: R2465_CLOSING_COMMISSION_MODE, fallbackMinimumDte, fallbackDelta, enableMaturityFallback, fallbackProfitFraction, coverageMode, coverageDelta, mandatoryUpstream: [...mandatoryUpstream], profitFraction, targetDelta, minimumSignalCredit, maximumRelativeSpread, rescueTargetDte, widthBudget, protectionQuoteSpread,
        creditFloorObservation: 'signal-close-net-after-both-opening-leg-fees' });
    const n = (o: Readonly<StrategyObject>, key: string) => typeof o[key] === 'number' ? Number(o[key]) : undefined;
    const object = (value: unknown, label: string): StrategyObject => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error(`Missing R9 ${label}`);
        return value as StrategyObject;
    };
    function r9NativeStockNav(native: Readonly<StrategyObject>) {
        const nav = Number(object(native.stockAccount, 'stock account').netLiquidation);
        if (!Number.isFinite(nav) || nav <= 0)
            throw new Error('Invalid R9 current stock NAV');
        return nav;
    }
    function r9CoordinateFacts(native: Readonly<StrategyObject>) {
        const c = object(native.marketContext, 'current context'), macro = object(native.macro, 'macro');
        if (typeof c.regime !== 'string')
            throw new Error('Missing R9 regime');
        const coordinates = resolveVolatilityCoordinates(macro, { positiveVixRequired: true, rawTermFallback: true });
        const primary = coordinates.primaryVol, term = coordinates.primaryVol3m, change = coordinates.primaryChange5d;
        const facts = projectNativeMarketFacts(c, n);
        const market: R9E226Market = { regime: c.regime, slowSubregime: typeof c.slowSubregime === 'string' ? c.slowSubregime : undefined,
            vix: facts.vix ?? primary, vix3m: term, primaryTermSlope: primary !== undefined && term !== undefined ? term - primary : undefined,
            rv20: facts.tqqqRealisedVol20d, adx14: facts.adx14, trendScore: facts.trendScore, sma200Pct: facts.priceVsSma200Pct,
            priceExtensionAtr: facts.priceExtensionAtr, regimePriceExtensionAtr: facts.priceExtensionAtr,
            range20dPct: facts.range20dPct, roc5: facts.roc5, roc20: facts.roc20, er20: facts.qqqEr20, rsi14: facts.rsi14,
            weakeningCount: facts.weakeningSignalCount, ma50SlopePct: facts.ma50SlopePct,
            drawdownFromRecentHighPct: facts.drawdownFromRecentHighPct, vixChange5d: change, regimeVixChange5d: facts.vixChange5d };
        return { coordinates: { market, primaryVol: primary, primaryVol3m: term }, facts };
    }
    const contract = (expiry: string, shortStrike: number, longStrike: number, targetDte: number): StrategyObject => ({ symbol: 'QQQ', type: 'put',
        expiry, shortStrike, longStrike, targetDte });
    return {
        manifest: { sdkVersion: 2, id: 'R2465', version: "r2465-simplified-v2", researchOnly: true,
            migration: { complete: true, missing: [] } }, params: defaults,
        initialize(params) {
            assertFixedStrategyParams(params, defaults);
            return ({ exitMemory: {} }) as StrategyObject;
        },
        onFeedback({ state, params, feedback }) {
            assertFixedStrategyParams(params, defaults);
            const id = String(feedback.payload.sourceAccount);
            if (!['portfolio', R9_E226_SOURCE_CONTRACT.contextSource].includes(id))
                throw new Error('Unknown R9 feedback source');
            settledFeedbackPnl(feedback);
            if (id !== 'portfolio')
                return state;
            const memory = { ...r2465RotationMemory((state as StrategyObject).exitMemory) };
            const positionId = String(feedback.payload.positionId);
            if (feedback.kind === 'fill') {
                if (!positionId || positionId === 'undefined' || feedback.payload.quantity !== 1 || feedback.payload.multiplier !== 1 || Object.hasOwn(memory, positionId))
                    throw Error('Invalid adaptive owned fill');
                memory[positionId] = { release: false };
            }
            else if (feedback.kind === 'close' || feedback.kind === 'settle') {
                if (!Object.hasOwn(memory, positionId))
                    throw Error('Missing adaptive closing feedback ownership');
                delete memory[positionId];
            }
            return { exitMemory: memory };
        },
        planObservations({ params, nativeState, annualizedQqqRv20, sourceId }) {
            assertFixedStrategyParams(params, defaults);
            if (sourceId !== R9_E226_SOURCE_CONTRACT.contextSource)
                return null;
            const { coordinates } = r9CoordinateFacts(nativeState), p = R9_MAIN_PCS_CONTRACT;
            const stressed = r9MainPcsStress({ regime: coordinates.market.regime, ...coordinates, annualizedQqqRv20 });
            return { widths: [p.widthPct], sigmas: stressOnlyPcsSelectionProfile(stressed).candidateSigmas, targetDte: p.targetDte,
                nav: r9NativeStockNav(nativeState), riskBudget: p.riskBudgetNav, forceMinimumContract: p.forceMinimumContract, includeTail: false };
        },
        onBar({ state: priorState, params, snapshot }) {
            assertFixedStrategyParams(params, defaults);
            if ((snapshot.market.executionCapabilities as StrategyObject | undefined)?.closingCommissionMode !== R2465_CLOSING_COMMISSION_MODE)
                throw Error('R2465 requires the declared account-default closing commission contract');
            if ((snapshot.market.executionCapabilities as StrategyObject).putMaturityMode !== 'extended-365-v1')
                throw Error('Extended coverage maturity capability required');
            const dtes = (snapshot.market.executionCapabilities as StrategyObject).putTargetDtes;
            if (!Array.isArray(dtes) || ![...R2465_OBSERVATION_DTES, Number(params.rescueTargetDte), coverageTargetDte, ...([63, 70, 75])].every(d => dtes.includes(d)))
                throw Error('R2465 requires its declared put maturity observation and execution capability');
            let state: StrategyObject = priorState as StrategyObject;
            const source = object(object(snapshot.market.sourceAccounts, 'source observations')[R9_E226_SOURCE_CONTRACT.contextSource], 'PCS source');
            const facts = object(source.market, 'source market'), native = object(facts.nativeState, 'native observation');
            const trace = createAdmissionTrace(['上游数据', '原有机会池准入', '原有低波动风控', '原有救援合约', '原有同日优先级']);
            let exits: StrategyIntent[] = [];
            const updateExits = (opportunity?: {
                credit: number;
                margin: number;
                days: number;
            }) => {
                const response = r2465RotationExits(snapshot, ((priorState as StrategyObject).exitMemory as StrategyObject), { opportunity });
                exits = response.intents;
                state = { exitMemory: response.memory };
            };
            const none = (reason: string) => { updateExits(); return { state, intents: exits, plots: { reason, gates: trace.gates } }; };
            if (native.available === false)
                return none('native-warmup-unavailable');
            const upstream = object(native.upstreamStatuses, 'upstream statuses');
            const legacyUpstreamBlocked = Object.values(upstream).some(s => s === 'BLOCK' || s === 'ERROR');
            trace.check(0, !legacyUpstreamBlocked, '上游观测与数据质量检查');
            if (r2465MandatoryBlocked(upstream))
                return none('upstream-block');
            const { coordinates, facts: admissionFacts } = r9CoordinateFacts(native), { market, primaryVol, primaryVol3m } = coordinates;
            market.versionPressure = isPcsV12GateBlocked({ enabled: true, v11ReleaseMode: 'rv20_lt_067_or_sr02_adx20',
                regime: market.regime, slowSubregime: market.slowSubregime, vix: market.vix, adx14: market.adx14,
                tqqqRealisedVol20d: market.rv20, priceVsSma200Pct: market.sma200Pct, range20dPct: market.range20dPct,
                priceExtensionAtr: market.priceExtensionAtr, roc5: market.roc5, roc20: market.roc20, rsi14: market.rsi14,
                weakeningSignalCount: market.weakeningCount, drawdownFromRecentHighPct: market.drawdownFromRecentHighPct });
            market.preCrisisActive = isCallCreditSpreadPreCrisis({ regime: market.regime, vix: primaryVol,
                tqqqRealisedVol20d: market.rv20, tqqqRoc20: admissionFacts.tqqqRoc20 });
            const quoteFee = Number((snapshot.market.executionCapabilities as StrategyObject).commissionPerContract);
            const macro = object(native.macro, 'macro');
            const admission = r9E226SourceAdmission({ market, macroVix: n(macro, 'vix'), macroVix3m: n(macro, 'vix3m'),
                crisisPhase: String(native.crisisPhase), backwardation: primaryVol !== undefined && primaryVol3m !== undefined && primaryVol3m < primaryVol,
                hasOpenCollar: false, collarTriggered: false });
            const analytics = object(facts.pcsAnalytics, 'PCS analytics');
            if (!Array.isArray(analytics.candidates))
                throw new Error('Missing R9 analytical candidates');
            const main = selectR9MainPcs({ ...coordinates, originalSignal: admission.originalSignal,
                annualizedQqqRv20: Number(analytics.annualizedQqqRv20), candidates: analytics.candidates as unknown as PcsAnalyticalProbe[] });
            const lowRvBlocked = r9E226LowRvBlocked(market);
            const built = !legacyUpstreamBlocked && admission.sourceActive && !lowRvBlocked
                ? buildQuoteOnlyRRescue({ chain: snapshot.market.chain as unknown as OptionChain, asOf: snapshot.asOf, market, fee: quoteFee }) : null;
            const rescue = built?.selected;
            const priority = r9E226ProposalPriority({ market, sourceActive: admission.sourceActive,
                mainPcsProposalBuilt: !!main.selected, rescueProposalBuilt: !!rescue });
            const fee = Number((snapshot.market.executionCapabilities as StrategyObject).commissionPerContract), minimum = Number(params.minimumSignalCredit);
            if (!Number.isFinite(fee) || fee < 0)
                throw Error('R2465 requires the actual account commission');
            const restoredPositive = !admission.originalSignal && Number.isFinite(market.roc5) && market.roc5! > 0 && Number.isFinite(market.roc20) && market.roc20! > 0;
            const core = !legacyUpstreamBlocked && admission.sourceActive && !!rescue && (!admission.originalSignal || admission.complement || r9E226DualMainQuality(market));
            const coverage = !core && r2465CoverageAfterMandatoryCheck({
                upstream, regime: market.regime, crisisPhase: String(native.crisisPhase), primary: primaryVol, primary3m: primaryVol3m,
                macroVix: n(macro, 'vix'), macroVix3m: n(macro, 'vix3m')
            });
            const floatingParentGeometry = r2465DynamicGeometry({
                spot: Number((snapshot.market.chain as StrategyObject).spot), vol: primaryVol,
                realizedVol: Number(analytics.annualizedQqqRv20), roc5: market.roc5, roc20: market.roc20, term: primaryVol !== undefined && primaryVol3m !== undefined ? primaryVol3m / primaryVol - 1 : undefined, heldCount: snapshot.positions.length
            });
            const floatingRiskGuard = r2465FloatingGuard({ core, restored: restoredPositive, regime: market.regime, roc5: market.roc5, roc20: market.roc20 });
            const dynamic = floatingParentGeometry;
            const entryQualityObserved = [primaryVol, primaryVol3m, Number(analytics.annualizedQqqRv20), market.roc5, market.roc20].every(v => typeof v === 'number' && Number.isFinite(v)) && Number(primaryVol) > 0 && Number(primaryVol3m) > 0;
            const exitQuality = floatingParentGeometry.quality;
            const stressGeometry = admission.originalSignal || primaryVol !== undefined && primaryVol >= 35;
            const activeDte = coverage ? coverageTargetDte : dynamic.dte;
            const bounds = core ? { maximumShortDelta: dynamic.delta, targetShortDelta: Math.min(built!.attempts[0]!.delta, dynamic.delta),
                maximumWidth: dynamic.width,
                minimumNetCredit: minimum, commissionPerContract: fee, maximumRelativeSpread: Number(params.maximumRelativeSpread) }
                : coverage ? { maximumShortDelta: coverageDelta, targetShortDelta: coverageDelta,
                    maximumWidth: 5, minimumNetCredit: minimum,
                    commissionPerContract: fee, maximumRelativeSpread: Number(params.maximumRelativeSpread) } : undefined;
            if (bounds && (stressGeometry)) {
                bounds.maximumShortDelta = Math.min(bounds.maximumShortDelta, 0.075);
                bounds.targetShortDelta = Math.min(bounds.targetShortDelta, 0.075);
                bounds.maximumWidth = Math.min(bounds.maximumWidth, 5);
            }
            const parentChosen = bounds ? selectAsymmetricPutSpread(snapshot.market.chain as unknown as OptionChain, snapshot.asOf, activeDte, bounds, Number(params.protectionQuoteSpread)) : undefined;
            const maturityRiskGuard = coverage && exitQuality <= 0;
            const maturityBounds = bounds ? r2465MaturityDeltaBeforeSafetyCaps(bounds, primaryVol) : undefined;
            if (maturityRiskGuard && maturityBounds) {
                maturityBounds.maximumShortDelta = Math.min(maturityBounds.maximumShortDelta, 0.1);
                maturityBounds.targetShortDelta = Math.min(maturityBounds.targetShortDelta!, 0.1);
            }
            if (maturityBounds && (stressGeometry)) {
                maturityBounds.maximumShortDelta = Math.min(maturityBounds.maximumShortDelta, 0.075);
                maturityBounds.targetShortDelta = Math.min(maturityBounds.targetShortDelta!, 0.075);
            }
            const maturityFallback = !parentChosen && maturityBounds && enableMaturityFallback ? r2465SelectMaturityFallback(snapshot.market.chain as unknown as OptionChain, snapshot.asOf, { ...maturityBounds,
                maximumWidth: 5 }, Number(params.protectionQuoteSpread)) : undefined;
            const reference = parentChosen ?? maturityFallback?.contract;
            const narrowChosen = reference;
            const maturityWide = !!maturityFallback && narrowChosen && entryQualityObserved
                ? r2465WidenProtection(snapshot.market.chain as unknown as OptionChain, narrowChosen, stressGeometry ? 5 : 10, fee) : undefined;
            const wideningScore = maturityWide && narrowChosen ? r2465MaturityWidenScore(narrowChosen, maturityWide, snapshot.asOf, exitQuality) : 0;
            const wideAccepted = !!maturityWide && wideningScore >= maturityWidenScoreFloor;
            const parentFinal = wideAccepted ? maturityWide! : narrowChosen;
            const recoveryReference = parentFinal;
            const recoveryDays = recoveryReference ? (Date.parse(recoveryReference.expiry) - Date.parse(snapshot.asOf)) / 86400000 : NaN;
            const recoveryCarry = recoveryReference && Number(recoveryReference.maxLoss) > 0 && recoveryDays > 0 ? (100 * Number(recoveryReference.credit) - 2 * fee) / Number(recoveryReference.maxLoss) / recoveryDays * 365 : NaN;
            const recoveryNarrowAllowed = false;
            const chosen = recoveryReference, selectedDte = maturityFallback?.targetDte ?? activeDte;
            const opportunity = chosen ? { credit: 100 * Number(chosen.credit) - 2 * fee, margin: Number(chosen.maxLoss), days: (Date.parse(chosen.expiry) - Date.parse(snapshot.asOf)) / 86400000 } : undefined;
            updateExits(opportunity);
            const priceEntryAllowed = true;
            const quoteEntryAllowed = true;
            const quotedDays = chosen ? (Date.parse(chosen.expiry) - Date.parse(snapshot.asOf)) / 86400000 : NaN;
            const quotedCarry = chosen && Number(chosen.maxLoss) > 0 && quotedDays > 0 ? (100 * Number(chosen.credit) - 2 * fee) / Number(chosen.maxLoss) / quotedDays * 365 : NaN;
            const hybridCarryThreshold = maturityFallback ? 0.15 : .225;
            const carryEntryAllowed = Number.isFinite(quotedCarry) && quotedCarry >= hybridCarryThreshold;
            const creditAllowed = (!floatingRiskGuard || !!maturityFallback) && !!chosen && carryEntryAllowed && r2465PriceEntryAllowed({ originalSignal: admission.originalSignal, roc5: market.roc5, roc20: market.roc20, priceExtensionAtr: market.priceExtensionAtr });
            trace.check(1, admission.sourceActive, `safety=${admission.safety}; scope=${admission.scope}; complement=${admission.complement}`);
            if (admission.sourceActive) {
                trace.check(2, !lowRvBlocked, lowRvBlocked ? '低波动风险阻断' : '低波动风控通过');
                if (!lowRvBlocked) {
                    trace.check(3, !!rescue && creditAllowed, rescue ? `信号时费后信用金下限 ${minimum}; passed=${creditAllowed}` : '救援候选不可构建');
                    if (rescue && creditAllowed)
                        trace.check(4, priority.rescue, `main=${priority.main}; rescue=${priority.rescue}; dual=${priority.dual}`);
                }
            }
            const intents: StrategyIntent[] = [...exits];
            const risk = (sourceAccount: string): StrategyObject => ({ sourceAccount, multiplier: 1, quantity: 1,
                ratioMin: 0, ratioMax: Number.MAX_VALUE, entrySource: sourceAccount === 'portfolio' ? 'r9-rescue' : 'r9-main-pcs' });
            if (!legacyUpstreamBlocked && priority.main && main.selected)
                intents.push({ kind: 'open-spread', key: `r9-main:${snapshot.asOf}`,
                    contract: contract(main.selected.expiry, main.selected.shortStrike, main.selected.longStrike, R9_MAIN_PCS_CONTRACT.targetDte), risk: risk(R9_E226_SOURCE_CONTRACT.contextSource) });
            if (creditAllowed) {
                const { shortStrike: short, longStrike: long, expiry } = chosen!;
                if (short === undefined || long === undefined || !expiry)
                    throw new Error('Incomplete R9 rescue contract');
                intents.push({ kind: 'open-spread', key: `${(maturityFallback ? (wideAccepted ? 'r9-maturity:wide' : 'r9-maturity') : coverage ? 'r9-coverage' : 'r9-rescue') + (restoredPositive ? ':restored-positive' : '')}:${snapshot.asOf}`, contract: contract(expiry, short, long, selectedDte),
                    risk: risk('portfolio') });
            }
            return { state, intents, plots: { reason: (core || coverage) ? creditAllowed ? 'rescue-admitted' : 'r10-87-parent-credit-below-fees-floor' : main.reason,
                    quotedCarry: Number.isFinite(quotedCarry) ? quotedCarry : null, maturityRiskGuard, floatingRiskGuard, hybridCarryThreshold, recoveryNarrowAllowed, recoveryCarry: Number.isFinite(recoveryCarry) ? recoveryCarry : null, carryEntryAllowed, restoredPositive, riskRouteWanted: false, positiveRiskRouted: false, unitQuoteOnlyRescue: true, priceEntryAllowed, quoteEntryAllowed, dynamicGeometry: { ...dynamic, policy: dynamicPolicy, intensity }, sourceActive: admission.sourceActive, lowRvBlocked, ...priority, coverage, maturityFallback: !!maturityFallback, selectedDte, legacyUpstreamBlocked, coverageMode, coverageAdmission: coverage ? coverageMode : 'inactive', coverageContractAllowed: coverage && creditAllowed, creditAllowed, gates: trace.gates } };
        },
    };
}
export const r2465StandaloneV1 = createR2465Module();
