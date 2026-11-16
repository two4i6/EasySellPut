import {finalizeExecutionBookRecords} from './execution-book-records-v1';
/** Research SDK execution seam. No strategy builder, admission pool or completed ledger input. */
import type { BarStrategyExecutionAdapter } from './strategy-host-v2';
import { copyStrategyData,freezeStrategyData, type StrategyFeedback, type StrategyIntent, type StrategyObject } from './strategy-module-v2';
import type { MarketDataSet } from '../engines/leveraged-overlay/v2/backtest/fixtures';
import { QQQ_EXPIRY_CALENDAR_VERSION } from '../engines/leveraged-overlay/backtest/mockOptions';
import { MOCK_OPTION_CALIBRATION } from '../engines/leveraged-overlay/backtest/mockOptionCalibration';
import { openCreditSpreadFill, optionCommission, type OptionPricing } from '../engines/leveraged-overlay/v2/options';
import { equityBoostFillEconomics } from '../engines/leveraged-overlay/v2/strategies/equity-boost-put-spread';
import { closePutCreditSpreadAtMark, finalizePutCreditSpread, type PutCreditSpreadPosition } from './put-spread-kernel-v6';
import type { FundedSpreadExecution } from './e209-execution-contract-v1';
import { assertSpreadFillRetryPolicy, selectSpreadFillRetry } from './spread-fill-retry-v3';
import {EXECUTION_AVAILABILITY_VERSION} from './execution-availability-v1';
import {createQqqMarketContext,QQQ_PUT_TARGET_DTES,type QqqMarketContext} from './qqq-market-context-v5';
import {createQqqExecutionQuotes} from './qqq-execution-quotes-v7';
import {closeCallSpreadAtMark,finalizeCallSpread,callSpreadShortDelta} from './call-spread-mark-v1';

export const QQQ_SPREAD_ADAPTER_VERSION = `qqq-spread-sdk-v2-research-v9-profit-protection-limits:${EXECUTION_AVAILABILITY_VERSION}:${QQQ_EXPIRY_CALENDAR_VERSION}`;
export type SpreadExecutionPolicy = {
  quantityMode?: 'signal-integer-v1';
  terminalOpenAtClose?: boolean;
  terminalMarkOnly?: boolean;
  fillRetry?: { version:'delta-parent-preserving-v1'|'delta-parent-chain-v2'; commissionPerContract:number };
};
export type QqqSpreadAdapterConfig = {
  startDate: string; endDate: string; initialCapital: number; commissionPerContract: number;
  pricing: OptionPricing; realStrikeGrid: boolean; liquidityModel: boolean;
  funded?: FundedSpreadExecution;
  /** Integer source-book quantity without pretending synthetic fills prove capacity. */
  quantityMode?: 'signal-integer-v1';
  /** Opt-in execution contract; omitted leaves E209's pricing/cost/model contract unchanged. */
  fillRetry?: SpreadExecutionPolicy['fillRetry'];
  /** Explicit research model: closing both legs uses the account fee, including retried openings. */
  closingCommissionMode?: 'account-default-v1';
  /** Explicit independent-PCS sample convention, never a strategy admission date gate. */
  terminalOpenAtClose?: boolean;
  /** Sample boundary valuation is not a real exit or settlement feedback. */
  terminalMarkOnly?: boolean;
  coordinated?: { version:'ordered-fill-v1'|'ordered-fill-with-overlays-v1'; policies:Record<string,SpreadExecutionPolicy>;
    /** Additional integer overlays have an independent one-opening-per-session slot. Base priorities are unchanged. */
    overlayPolicies?:string[] };
  /** Call-only, integer contracts. Omission preserves the put execution identity. */
  callCreditSpread?: {version:'call-credit-v1';targetDtes:number[]};
  /** Opt-in put maturities; omission preserves the historical 28/35 chains and identity. */
  putTargetDtes?:number[];
  /** Separately identified research capability; legacy explicit put maturities remain capped at 75. */
  putMaturityMode?:'extended-365-v1';
  /** Explicit opt-in for bounded pair retries beyond75DTE; no collateral budget. */
  boundedPutRetryVersion?:'bounded-put-pairs-extended-v1';
  /** Explicit research capability. Intent budgets govern only selected coordinated policy positions. */
  policyMarginBudgetVersion?:'intent-policy-margin-v1';
  /** Opt-in inventory partitions within one selected execution policy. */
  policyGroupMarginBudgetVersion?:'intent-policy-group-margin-v1';
};
export const QQQ_SPREAD_ADAPTER_DEFAULTS = {
  initialCapital: 100_000, commissionPerContract: .65,
  pricing: { spreadMultiplier: 1, skewSlope: MOCK_OPTION_CALIBRATION.skewSlope, riskFreeRate: .045 },
  realStrikeGrid: true, liquidityModel: true,
};
type Position = PutCreditSpreadPosition & { id: string; signalDate: string; openDate: string; multiplier: number; margin: number; entrySource?: string;
  executionPolicy?: string; executionCommission?: number; policyInventoryGroup?:string; type?:'call' };
type Pending = { signalDate: string; intent: StrategyIntent; fillContracts: readonly StrategyObject[] };
export type SpreadExecutionEvent = StrategyFeedback;

function date(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function number(object: StrategyObject, key: string, min: number): number {
  const value = object[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) throw new Error(`Invalid spread ${key}`);
  return value;
}

/**
 * Flat-cost QQQ credit spreads (call is explicit opt-in), next-open fills,
 * explicit strategy closes, intrinsic settlement and terminal liquidation.
 * Weighted research units are NOT live integer order quantities. This virtual
 * overlay cash ledger is not the legacy equity allocation account.
 */
export function createQqqSpreadExecutionAdapter(data: MarketDataSet, config: QqqSpreadAdapterConfig, market?:QqqMarketContext) {
  market?.assertData(data);
  const decisionMarket=market??createQqqMarketContext(data,false);
  const marketData=decisionMarket.data;
  let finalized=false;
  config = copyStrategyData(config);
  const call=config.callCreditSpread;
  if(call!==undefined&&(!call||call.version!=='call-credit-v1'||!Array.isArray(call.targetDtes)||!call.targetDtes.length
    ||call.targetDtes.length>16||call.targetDtes.some(d=>!Number.isInteger(d)||d<1||d>75)
    ||new Set(call.targetDtes).size!==call.targetDtes.length||config.quantityMode!=='signal-integer-v1'
    ||config.funded||config.coordinated||config.fillRetry))throw Error('Invalid call credit execution capability');
  const putDtes=config.putTargetDtes??QQQ_PUT_TARGET_DTES;
  if(config.putMaturityMode!==undefined&&(config.putMaturityMode!=='extended-365-v1'||call||config.putTargetDtes===undefined))throw Error('Invalid extended put maturity capability');
  if(config.putTargetDtes!==undefined&&(call||!Array.isArray(putDtes)||!putDtes.length||putDtes.length>16
    ||putDtes.some(d=>!Number.isInteger(d)||d<1||d>(config.putMaturityMode?365:75))||new Set(putDtes).size!==putDtes.length))throw Error('Invalid put maturity capability');
  if(config.boundedPutRetryVersion!==undefined&&(config.boundedPutRetryVersion!=='bounded-put-pairs-extended-v1'||config.putMaturityMode!=='extended-365-v1'||config.funded||call))throw Error('Invalid extended bounded put retry capability');
  const closeAtMark=call?closeCallSpreadAtMark:closePutCreditSpreadAtMark;
  const finalize=call?finalizeCallSpread:finalizePutCreditSpread;
  if (!date(config.startDate) || !date(config.endDate) || config.startDate > config.endDate) throw new Error('Invalid research window');
  if (!(config.initialCapital > 0) || !Number.isFinite(config.initialCapital)
    || !(config.commissionPerContract >= 0) || !Number.isFinite(config.commissionPerContract)
    || Object.values(config.pricing).some(value => !Number.isFinite(value))
    || config.pricing.spreadMultiplier <= 0 || config.pricing.riskFreeRate < 0) throw new Error('Invalid execution assumptions');
  if (!data.fingerprint || !data.qqqBars.length || !data.tqqqBars.length) throw new Error('Complete QQQ/TQQQ data required');
  if (config.quantityMode !== undefined && (config.quantityMode !== 'signal-integer-v1' || config.funded)) throw new Error('Invalid/conflicting quantity contract');
  if (config.fillRetry && (!['delta-parent-preserving-v1','delta-parent-chain-v2'].includes(config.fillRetry.version)
    || !Number.isFinite(config.fillRetry.commissionPerContract) || config.fillRetry.commissionPerContract < 0)) throw new Error('Invalid retry execution contract');
  if(config.closingCommissionMode!==undefined&&config.closingCommissionMode!=='account-default-v1')throw Error('Invalid closing commission contract');
  if(config.policyMarginBudgetVersion!==undefined&&(config.policyMarginBudgetVersion!=='intent-policy-margin-v1'||config.funded||call))throw Error('Invalid policy margin budget capability');
  if(config.policyGroupMarginBudgetVersion!==undefined&&(config.policyGroupMarginBudgetVersion!=='intent-policy-group-margin-v1'||config.funded||call))throw Error('Invalid policy group margin budget capability');
  if (config.coordinated !== undefined) {
    const c=config.coordinated;
    if(!c||typeof c!=='object'||Array.isArray(c)||!['ordered-fill-v1','ordered-fill-with-overlays-v1'].includes(c.version)||config.funded||!c.policies||Array.isArray(c.policies)
      ||typeof c.policies!=='object'||!Object.keys(c.policies).length)throw Error('Invalid coordinated execution contract');
    if(c.version==='ordered-fill-v1'?c.overlayPolicies!==undefined
      :!Array.isArray(c.overlayPolicies)||!c.overlayPolicies.length||c.overlayPolicies.length>16
        ||new Set(c.overlayPolicies).size!==c.overlayPolicies.length
        ||c.overlayPolicies.some(id=>typeof id!=='string'||!Object.hasOwn(c.policies,id)||c.policies[id]!.quantityMode!=='signal-integer-v1'))
      throw Error('Invalid coordinated overlay policies');
    for(const [id,p] of Object.entries(c.policies)){
      if(!id||!p||typeof p!=='object'||Array.isArray(p)
        ||Object.keys(p).some(k=>!['quantityMode','terminalOpenAtClose','terminalMarkOnly','fillRetry'].includes(k))
        ||(p.quantityMode!==undefined&&p.quantityMode!=='signal-integer-v1')
        ||(p.terminalOpenAtClose!==undefined&&typeof p.terminalOpenAtClose!=='boolean')
        ||(p.terminalMarkOnly!==undefined&&typeof p.terminalMarkOnly!=='boolean')
        ||(p.fillRetry!==undefined&&(!p.fillRetry||typeof p.fillRetry!=='object'||Array.isArray(p.fillRetry)
          ||!['delta-parent-preserving-v1','delta-parent-chain-v2'].includes(p.fillRetry.version)
          ||!Number.isFinite(p.fillRetry.commissionPerContract)||p.fillRetry.commissionPerContract<0)))throw Error('Invalid coordinated execution policy');
    }
  }
  const policyFor=(name:unknown):SpreadExecutionPolicy=>{
    if(!config.coordinated)return config;
    if(typeof name!=='string'||!Object.hasOwn(config.coordinated.policies,name))throw Error('Unknown coordinated execution policy');
    return config.coordinated.policies[name]!;
  };
  if (config.funded && (config.funded.version !== 'funded-spread-v1'
    || !Number.isSafeInteger(config.funded.maxContractsPerOrder) || config.funded.maxContractsPerOrder < 1
    || !(config.funded.participationRate > 0 && config.funded.participationRate <= 1)
    || !(config.funded.maxOrderRiskFraction > 0 && config.funded.maxOrderRiskFraction <= 1)
    || !Number.isFinite(config.funded.slippagePerLeg) || config.funded.slippagePerLeg < 0
    || config.funded.liquidityEvidence !== 'synthetic-not-observed' || !config.liquidityModel)) throw new Error('Invalid funded execution contract');
  for (let i = 0; i < data.qqqBars.length; i++) {
    const bar = data.qqqBars[i]!;
    if (!date(bar.date) || (i > 0 && bar.date <= data.qqqBars[i - 1]!.date)
      || ![bar.open, bar.close].every(value => Number.isFinite(value) && value > 0)
      || (call&&(!Number.isFinite(bar.high)||bar.high<Math.max(bar.open,bar.close)))) throw new Error('Invalid QQQ history');
  }
  const bars = marketData.replayBars(config.startDate,config.endDate);
  if (!bars.length) throw new Error('No replay bars in available window');
  const resolvedEndDate = bars.at(-1)!.date;
  const splitEvents = data.splitEventsBySymbol?.QQQ?.value ?? [];
  if (splitEvents.length) throw new Error('QQQ split execution migration incomplete');
  let index = -1, submitted = false, cash = config.initialCapital, realized = 0;
  let peak = config.initialCapital, realizedPeak = 0, mtmMdd = 0, realizedMdd = 0;
  let beforeBarPeaks = { peak, realizedPeak, mtmMdd, realizedMdd };
  let lastOpeningSession:string|null=null;
  const overlayOpeningSessions=new Map<string,string>();
  const positions = new Map<string, Position>();
  const pending: Pending[] = [], events: SpreadExecutionEvent[] = [], curves: StrategyObject[] = [];
  const intentKeys = new Set<string>();
  const vol = marketData.executionVolatility;
  const executionQuotes=createQqqExecutionQuotes(data,{pricing:config.pricing,
    realStrikeGrid:config.realStrikeGrid,liquidityModel:config.liquidityModel,...(config.putMaturityMode?{putMaturityMode:config.putMaturityMode}:{})},market);
  const emit = (kind: StrategyFeedback['kind'], asOf: string, payload: StrategyObject, feedback: StrategyFeedback[]) => {
    const event = { id: `execution:${events.length + 1}`, asOf, kind, payload };
    events.push(copyStrategyData(event)); feedback.push(event);
  };
  const finish = (position: Position, asOf: string, cashImpact: number, pnl: number, kind: 'close' | 'settle', reason: string, feedback: StrategyFeedback[],
    execution?:{executionTime:'open'|'close';quoteAsOf:string}) => {
    const executionCost = kind === 'close' ? (config.funded?.slippagePerLeg ?? 0) * 200 * position.quantity : 0;
    cashImpact -= executionCost; pnl -= executionCost;
    const weightedCashImpact = cashImpact * position.multiplier, weightedPnl = pnl * position.multiplier;
    cash += weightedCashImpact; realized += weightedPnl;
    positions.delete(position.id);
    emit(kind, asOf, { positionId: position.id, signalDate: position.signalDate, openDate: position.openDate,
      expiry: position.expiry, quantity: position.quantity, multiplier: position.multiplier,
      shortStrike: position.shortStrike, longStrike: position.longStrike, cashImpact, weightedCashImpact,
      pnl: weightedPnl, unweightedPnl: pnl, win: weightedPnl > 0, reason,
      ...(position.entrySource ? { entrySource: position.entrySource } : {}),
      ...(call?{type:'call',...execution}:{}),
      ...(position.executionPolicy ? {executionPolicy:position.executionPolicy} : {}) }, feedback);
  };
  // Side-effect-free preflight allows a coordinated source adapter to validate
  // every account before committing any queued intents.
  const validateSubmission = (asOf: string, intents: readonly StrategyIntent[]) => {
    if(finalized)throw Error('Execution evidence is finalized');
    if (bars[index]?.date !== asOf || submitted) throw new Error('Invalid/duplicate adapter submission');
    const cloned = freezeStrategyData(intents), batchKeys = new Set<string>();
    for (const intent of cloned) {
      if (!intent.key || intentKeys.has(intent.key) || batchKeys.has(intent.key)) throw new Error('Duplicate adapter intent');
      batchKeys.add(intent.key);
      if (intent.kind === 'open-spread') {
        const c = intent.contract;
        if (c.symbol !== 'QQQ' || c.type !== (call?'call':'put') || typeof c.expiry !== 'string' || !date(c.expiry)
          || (call?number(c,'longStrike',Number.MIN_VALUE)<=number(c,'shortStrike',Number.MIN_VALUE)
            :number(c, 'shortStrike', Number.MIN_VALUE) <= number(c, 'longStrike', Number.MIN_VALUE))
          || !(call?call.targetDtes:putDtes).includes(number(c, 'targetDte', 1))) throw new Error('Unsupported spread contract');
        number(intent.risk, 'multiplier', Number.MIN_VALUE);
        if(intent.risk.maximumPolicyMargin!==undefined){
          if(config.policyMarginBudgetVersion!=='intent-policy-margin-v1')throw Error('Policy margin budget capability not enabled');
          number(intent.risk,'maximumPolicyMargin',Number.MIN_VALUE);
        }
        if(intent.risk.policyInventoryGroup!==undefined||intent.risk.maximumPolicyGroupMargin!==undefined){
          if(config.policyGroupMarginBudgetVersion!=='intent-policy-group-margin-v1')throw Error('Policy group margin budget capability not enabled');
          if(typeof intent.risk.policyInventoryGroup!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(intent.risk.policyInventoryGroup))throw Error('Invalid policy inventory group');
          if(intent.risk.maximumPolicyGroupMargin!==undefined)number(intent.risk,'maximumPolicyGroupMargin',Number.MIN_VALUE);
        }
        if(intent.risk.minUnderlyingPrice!==undefined)number(intent.risk,'minUnderlyingPrice',Number.MIN_VALUE);
        if(intent.risk.maxUnderlyingPrice!==undefined)number(intent.risk,'maxUnderlyingPrice',
          typeof intent.risk.minUnderlyingPrice==='number'?intent.risk.minUnderlyingPrice:Number.MIN_VALUE);
        if(call&&(intent.risk.multiplier!==1||intent.risk.fillPrerequisite!==undefined||intent.risk.fillRetry!==undefined))
          throw Error('Call execution requires integer-only sizing without put retry/prerequisite');
        if(intent.risk.callFillCondition!==undefined)throw Error('Resolve strategy fill conditions into an explicit minimum fill credit');
        if(intent.risk.minFillCreditPerContract!==undefined){
          if(!call)throw Error('Call minimum fill credit capability not enabled');
          number(intent.risk,'minFillCreditPerContract',0);
        }
        const executionPolicy=policyFor(intent.risk.executionPolicy);
        if(config.coordinated?.overlayPolicies?.includes(String(intent.risk.executionPolicy))&&intent.risk.multiplier!==1)
          throw Error('Overlay execution requires unweighted integer quantity');
        if(config.coordinated)number(intent.risk,'openingPriority',0);
        if(intent.risk.openingParentKey!==undefined){
          const parent=intent.risk.openingParentKey;
          if(!config.coordinated||intent.risk.executionPolicy!=='p'||typeof parent!=='string'||!parent||parent.endsWith(':research-extra')
            ||intent.key!==parent+':research-extra'||intent.risk.quantity!==1||intent.risk.multiplier!==1
            ||intent.risk.researchSleeve!=='extra'||intent.risk.researchCombinedQuantity!==2)
            throw Error('Invalid paired P6 opening');
        }
        if (executionPolicy.quantityMode) {
          if (!Number.isSafeInteger(intent.risk.quantity) || Number(intent.risk.quantity) < 1
            || Number(intent.risk.quantity) > 100_000) throw new Error('Invalid/beyond-budget integer source quantity');
        } else if (intent.risk.quantity !== undefined) throw new Error('Integer quantity capability not enabled');
        number(intent.risk, 'ratioMax', number(intent.risk, 'ratioMin', 0));
        if (intent.risk.fillRetry !== undefined) {
          if (!executionPolicy.fillRetry) throw new Error('Fill retry execution capability not enabled');
          assertSpreadFillRetryPolicy(intent.risk.fillRetry);
          const retry=intent.risk.fillRetry;
          if(retry.version==='bounded-put-pairs-extended-v1'&&(config.boundedPutRetryVersion!==retry.version||!putDtes.includes(retry.targetDte)||c.targetDte!==retry.targetDte))throw Error('Extended bounded put retry capability/declared maturity mismatch');
        }
        if (intent.risk.entrySource !== undefined && (typeof intent.risk.entrySource !== 'string'
          || !/^[a-z][a-z0-9-]{0,63}$/.test(intent.risk.entrySource))) throw new Error('Invalid entry source identity');
        if (intent.risk.fillPrerequisite !== undefined) {
          const prerequisite = intent.risk.fillPrerequisite as StrategyObject;
          if (!prerequisite || typeof prerequisite !== 'object' || Array.isArray(prerequisite)
            || typeof prerequisite.expiry !== 'string' || !date(prerequisite.expiry)
            || number(prerequisite, 'shortStrike', Number.MIN_VALUE) <= number(prerequisite, 'longStrike', Number.MIN_VALUE)
            || number(prerequisite, 'targetDte', 1) !== 35) throw new Error('Invalid fill prerequisite');
        }
        if (intent.risk.longProtectionFallback !== undefined) {
          const protection = intent.risk.longProtectionFallback as StrategyObject;
          if (call || intent.risk.fillRetry !== undefined || !protection || typeof protection !== 'object'
            || Array.isArray(protection) || number(protection, 'maximumWidth', Number.MIN_VALUE)
              < Number(c.shortStrike) - Number(c.longStrike)) throw new Error('Invalid long protection width');
        }
      } else if (intent.kind === 'close-position') {
        if (intent.minimumUnweightedPnl !== undefined && (typeof intent.minimumUnweightedPnl !== 'number'
          || !Number.isFinite(intent.minimumUnweightedPnl) || intent.minimumUnweightedPnl < 0))
          throw new Error('Invalid profit close limit');
      } else throw new Error('Unsupported execution intent');
    }
    if (asOf === resolvedEndDate && intents.length && !config.terminalOpenAtClose && !config.coordinated) throw new Error('No next bar inside replay sample');
    return cloned;
  };
  const executePending = (asOf: string, feedback: StrategyFeedback[], atClose=false) => {
      if(!pending.length)return;
      const quotes=executionQuotes.forSession(asOf,atClose?'terminal-close':'next-open');
      const {quoteAsOf,spot,vix,pricingVol,pricingVol3m}=quotes.coordinates;
      const quote=quotes.quote;
      // Previous-close intents fill now, then expiry settles before this close decision.
      const batch=pending.splice(0);
      if(config.coordinated)batch.sort((a,b)=>(a.intent.kind==='close-position'?-1:Number(a.intent.risk.openingPriority))
        -(b.intent.kind==='close-position'?-1:Number(b.intent.risk.openingPriority)));
      for (const queued of batch) {
        const intent = queued.intent;
        if (intent.kind === 'close-position') {
          const position = positions.get(intent.positionId);
          if (!position) { emit('reject', asOf, { key: intent.key, reason: 'position-not-open' }, feedback); continue; }
          const marked = closeAtMark(position, asOf, spot, pricingVol, intent.reason, config.pricing, pricingVol3m);
          const commission = optionCommission(2, position.quantity, config.closingCommissionMode==='account-default-v1'
            ?config.commissionPerContract:position.executionCommission ?? config.commissionPerContract);
          const limit = intent.minimumUnweightedPnl;
          if (limit !== undefined) {
            const net = marked.pnl - commission - (config.funded?.slippagePerLeg ?? 0) * 200 * position.quantity;
            if (net < limit) {
              emit('reject', asOf, { key: intent.key, positionId: position.id, reason: 'profit-close-limit-unmet',
                minimumUnweightedPnl: limit, quotedPnl: net }, feedback);
              continue;
            }
          }
          finish(position, asOf, marked.cashImpact - commission, marked.pnl - commission, 'close', intent.reason, feedback,
            call?{executionTime:atClose?'close':'open',quoteAsOf}:undefined);
          continue;
        }
        const c = intent.contract, risk = intent.risk;
        if(typeof risk.minUnderlyingPrice==='number'&&spot<risk.minUnderlyingPrice
          ||typeof risk.maxUnderlyingPrice==='number'&&spot>risk.maxUnderlyingPrice){
          emit('reject',asOf,{key:intent.key,reason:'underlying-price-out-of-bounds'},feedback);continue;
        }
        const executionPolicy=policyFor(risk.executionPolicy),fillRetry=executionPolicy.fillRetry;
        if(config.coordinated){
          const overlay=config.coordinated.overlayPolicies?.includes(String(risk.executionPolicy))===true;
          const parent=typeof risk.openingParentKey==='string'?positions.get(risk.openingParentKey):undefined;
          const paired=parent&&parent.quantity===1&&parent.multiplier===1&&parent.openDate===asOf
            &&parent.signalDate===queued.signalDate&&parent.executionPolicy===risk.executionPolicy;
          const reason=atClose&&!executionPolicy.terminalOpenAtClose?'terminal-opening-unsupported'
            :risk.openingParentKey!==undefined&&!paired?'opening-parent-not-filled'
            :(overlay?overlayOpeningSessions.get(String(risk.executionPolicy)):lastOpeningSession)===asOf&&!paired?'opening-preempted':null;
          if(reason){emit('reject',asOf,{key:intent.key,reason,executionPolicy:String(risk.executionPolicy)},feedback);continue;}
        }
        // Conditional sibling execution is evaluated NOW at the actual fill bar.
        // No next-bar quote enters the preceding strategy observation/decision.
        if (risk.fillPrerequisite) {
          const prerequisite = risk.fillPrerequisite as StrategyObject;
          const expiry = String(prerequisite.expiry);
          const { short, long } = quote(prerequisite);
          const fill = openCreditSpreadFill({ requestedQuantity: 1, maxQuantity: 1, shortBid: short?.bid, longAsk: long?.ask,
            strikeVolume: Math.min(short?.volume ?? Infinity, long?.volume ?? Infinity), vix, impactEnabled: false,
            commissionPerContract: config.commissionPerContract });
          if (!short || !long || expiry <= asOf || fill.totalCredit <= 0) {
            emit('reject', asOf, { key: intent.key, reason: 'source-prerequisite-not-fillable' }, feedback); continue;
          }
        }
        let shortStrike = number(c, 'shortStrike', Number.MIN_VALUE), longStrike = number(c, 'longStrike', Number.MIN_VALUE);
        const ratioMin = number(risk, 'ratioMin', 0), ratioMax = number(risk, 'ratioMax', ratioMin);
        const requestedMultiplier = number(risk, 'multiplier', Number.MIN_VALUE);
        const multiplier = config.funded ? 1 : requestedMultiplier;
        let expiry = c.expiry as string;
        let { short, long } = quote(c);
        const protection = risk.longProtectionFallback as StrategyObject | undefined;
        if (protection && short && !long) {
          const available = quotes.retryChain(Number(c.targetDte), true).expirations.find(exp => exp.date === expiry)?.puts ?? [];
          const candidate = available.filter(leg => leg.strike < shortStrike
            && shortStrike - leg.strike <= Number(protection.maximumWidth)
            && Number.isFinite(leg.ask) && leg.ask > 0).sort((a, b) => a.strike - b.strike)[0];
          if (candidate) { long = candidate; longStrike = candidate.strike; }
        }
        let retried = false, expandedRetry = false, retryCredit:number|undefined;
        if (risk.fillRetry !== undefined) {
          const probe = openCreditSpreadFill({ requestedQuantity:1,maxQuantity:1,shortBid:short?.bid,longAsk:long?.ask,
            strikeVolume:Math.min(short?.volume ?? Infinity,long?.volume ?? Infinity), vix,
            impactEnabled:false,commissionPerContract:config.commissionPerContract });
          if (!short || !long || expiry <= asOf || probe.quantity !== 1 || probe.totalCredit <= 0) {
            const policy = risk.fillRetry;
            assertSpreadFillRetryPolicy(policy);
            const selected = selectSpreadFillRetry({policy,asOf,
              chain:fillRetry?.version==='delta-parent-chain-v2'?quotes.parentChain(queued.fillContracts):quotes.retryChain(policy.targetDte,false),
              expandedChain:()=>quotes.retryChain(policy.targetDte,true)});
            if (!selected.built.open) { emit('reject',asOf,{key:intent.key,reason:'fill-retry-no-contract'},feedback); continue; }
            const open = selected.built.open;
            shortStrike=open.shortStrike; longStrike=open.longStrike; expiry=open.expiry;
            ({short,long}=quote({expiry,shortStrike,longStrike,targetDte:policy.targetDte}));
            if(fillRetry?.version==='delta-parent-chain-v2'){
              // A retry builder owns its selected quote (including sparse-chain
              // synthetic legs); do not reprice it through the parent quote path.
              retryCredit=open.credit;
              if(retryCredit===undefined||!Number.isFinite(retryCredit)||retryCredit<=0){
                emit('reject',asOf,{key:intent.key,reason:'fill-retry-no-credit'},feedback);continue;
              }
            }
            retried=true; expandedRetry=selected.expanded;
          }
        }
        if ((retryCredit===undefined&&(!short || !long)) || expiry <= asOf) { emit('reject', asOf, { key: intent.key, reason: 'unavailable-fill-contract' }, feedback); continue; }
        const strikeVolume = retryCredit===undefined?Math.min(short!.volume, long!.volume):Infinity, width = call?longStrike-shortStrike:shortStrike-longStrike;
        const requestedQuantity = config.funded ? Math.floor(requestedMultiplier)
          : executionPolicy.quantityMode ? Number(risk.quantity) : 1;
        const existingMargin = [...positions.values()].reduce((sum, p) => sum + p.margin, 0);
        const openingEquity = config.funded ? config.initialCapital + realized + [...positions.values()].reduce((sum, p) => sum
          + closeAtMark(p, asOf, spot, pricingVol, 'funding-preflight', config.pricing, pricingVol3m).pnl * p.multiplier, 0) : 0;
        // Gross width collateral, without recycling the incoming premium. Conservative,
        // not a representation of any particular broker's portfolio-margin rules.
        const capacityQuantity = config.funded ? Math.max(0, Math.min(config.funded.maxContractsPerOrder,
          Math.floor(strikeVolume * config.funded.participationRate),
          Math.floor(Math.max(0, cash - existingMargin) / (width * 100)),
          Math.floor(Math.max(0, openingEquity) * config.funded.maxOrderRiskFraction / (width * 100)))) : requestedQuantity;
        if (requestedQuantity < 1 || capacityQuantity < 1) {
          emit('reject', asOf, { key: intent.key, reason: requestedQuantity < 1 ? 'integer-quantity-zero' : 'funding-or-modeled-capacity',
            requestedMultiplier, requestedQuantity, capacityQuantity, strikeVolume }, feedback); continue;
        }
        const retryQuantity=Math.min(requestedQuantity,capacityQuantity);
        const fill = retryCredit!==undefined?{quantity:retryQuantity,
          totalCredit:retryCredit*100*retryQuantity-optionCommission(2,retryQuantity,fillRetry!.commissionPerContract)}
          :openCreditSpreadFill({ requestedQuantity, maxQuantity: capacityQuantity,
          shortBid: short!.bid - (config.funded?.slippagePerLeg ?? 0), longAsk: long!.ask + (config.funded?.slippagePerLeg ?? 0),
          strikeVolume, vix, impactEnabled: Boolean(config.funded),
          commissionPerContract:retried ? fillRetry!.commissionPerContract : config.commissionPerContract });
        // Strategy resolves all as-of gates; execution only enforces its declared credit limit.
        if(call&&risk.minFillCreditPerContract!==undefined
          &&(short!.bid-long!.ask)*100<Number(risk.minFillCreditPerContract)){
          emit('reject',asOf,{key:intent.key,reason:'fill-credit-below-minimum'},feedback);continue;
        }
        const economics = equityBoostFillEconomics(width, fill.totalCredit, fill.quantity);
        if (!economics || economics.creditToMaxLoss < ratioMin || economics.creditToMaxLoss > ratioMax) {
          emit('reject', asOf, { key: intent.key, reason: 'fill-ratio-out-of-bounds' }, feedback); continue;
        }
        if(typeof risk.openingParentKey==='string'){
          const parent=positions.get(risk.openingParentKey)!;
          if(parent.shortStrike!==shortStrike||parent.longStrike!==longStrike||parent.expiry!==expiry){
            emit('reject',asOf,{key:intent.key,reason:'opening-sleeve-mismatch'},feedback);continue;
          }
        }
        const openingMargin=config.funded?width*100*fill.quantity:economics.maxLossPerContract*fill.quantity*multiplier;
        if(config.coordinated&&risk.maximumPolicyMargin!==undefined){
          const heldMargin=[...positions.values()].filter(p=>p.executionPolicy===risk.executionPolicy).reduce((sum,p)=>sum+p.margin,0);
          if(heldMargin+openingMargin>Number(risk.maximumPolicyMargin)){
            emit('reject',asOf,{key:intent.key,reason:'policy-margin-budget-exceeded',executionPolicy:String(risk.executionPolicy),
              maximumPolicyMargin:risk.maximumPolicyMargin,heldMargin,openingMargin},feedback);continue;
          }
        }
        const position: Position = { id: intent.key, signalDate: queued.signalDate, openDate: asOf,
          underlying: 'QQQ', expiry, quantity: fill.quantity, shortStrike, longStrike, width,
          creditReceived: fill.totalCredit, multiplier, margin:openingMargin };
        if(config.coordinated&&risk.maximumPolicyGroupMargin!==undefined){
          const heldMargin=[...positions.values()].filter(p=>p.executionPolicy===risk.executionPolicy&&p.policyInventoryGroup===risk.policyInventoryGroup).reduce((sum,p)=>sum+p.margin,0);
          if(heldMargin+openingMargin>Number(risk.maximumPolicyGroupMargin)){
            emit('reject',asOf,{key:intent.key,reason:'policy-group-margin-budget-exceeded',executionPolicy:String(risk.executionPolicy),
              policyInventoryGroup:risk.policyInventoryGroup,maximumPolicyGroupMargin:risk.maximumPolicyGroupMargin,heldMargin,openingMargin},feedback);continue;
          }
        }
        if(typeof risk.policyInventoryGroup==='string')position.policyInventoryGroup=risk.policyInventoryGroup;
        if(call)position.type='call';
        if (typeof risk.entrySource === 'string') position.entrySource = risk.entrySource;
        if(config.coordinated){
          position.executionPolicy=String(risk.executionPolicy);
          position.executionCommission=retried?fillRetry!.commissionPerContract:config.commissionPerContract;
          if(config.coordinated.overlayPolicies?.includes(String(risk.executionPolicy)))overlayOpeningSessions.set(String(risk.executionPolicy),asOf);
          else lastOpeningSession=asOf;
        }
        positions.set(position.id, position); cash += fill.totalCredit * multiplier;
        emit('fill', asOf, { positionId: position.id, signalDate: queued.signalDate, openDate: asOf, expiry,
          shortStrike, longStrike, quantity: fill.quantity, multiplier, cashImpact: fill.totalCredit,
          quoteAsOf,executionTime:atClose?'close':'open',
          ...(config.funded ? { requestedMultiplier, requestedQuantity, capacityQuantity, strikeVolume,
            partialFill: fill.quantity < requestedQuantity, liquidityEvidence: config.funded.liquidityEvidence } : {}),
          weightedCashImpact: fill.totalCredit * multiplier, margin: position.margin,
          ...(position.policyInventoryGroup?{policyInventoryGroup:position.policyInventoryGroup}:{}),
          ...(call?{type:'call',targetDte:Number(c.targetDte),creditPerContract:(short!.bid-long!.ask)*100}:{}),
          ...(retried ? { fillRetried:true, expandedRetry } : {}),
          ...(position.entrySource ? { entrySource: position.entrySource } : {}),
          ...(position.executionPolicy ? {executionPolicy:position.executionPolicy} : {}) }, feedback);
      }
  };
  const settleAndMark = (asOf: string, feedback: StrategyFeedback[]) => {
      const bar = bars[index]!, { pricingVol, pricingVol3m } = vol(asOf);
      for (const position of [...positions.values()]) {
        if (position.expiry > asOf && asOf !== resolvedEndDate) continue;
        if (position.expiry > asOf && policyFor(position.executionPolicy).terminalMarkOnly) continue;
        const closed = finalize({ position, asOfDate: asOf, qqqClose: bar.close,
          vix: pricingVol, vix3m: pricingVol3m, pricing: config.pricing,
          // Native ordinary expiry settles intrinsically with commission: 0.
          // Terminal liquidation of an UNEXPIRED spread still pays both legs.
          commission: position.expiry <= asOf ? 0 : optionCommission(2, position.quantity,config.closingCommissionMode==='account-default-v1'
            ?config.commissionPerContract:position.executionCommission ?? config.commissionPerContract) });
        finish(position, asOf, closed.cashImpact, closed.pnl, closed.settled ? 'settle' : 'close',
          closed.settled ? 'expiry' : 'sample-terminal-liquidation', feedback,call?{executionTime:'close',quoteAsOf:asOf}:undefined);
      }
      // Existing EB realized MDD groups all close events on the same day.
      realizedPeak = Math.max(realizedPeak, realized); realizedMdd = Math.max(realizedMdd, realizedPeak - realized);
      let unrealized = 0, margin = 0;
      const observedPositions = [...positions.values()].map(position => {
        const mark = closeAtMark(position, asOf, bar.close, pricingVol, 'mark', config.pricing, pricingVol3m);
        unrealized += mark.pnl * position.multiplier; margin += position.margin;
        const currentIndex=call?marketData.indexOf(data.qqqBars,asOf):undefined;
        const previousBar=currentIndex!==undefined&&currentIndex>0?data.qqqBars[currentIndex-1]:undefined;
        const previousVol=previousBar?vol(previousBar.date):undefined;
        return { ...position, markPnl: mark.pnl, weightedMarkPnl: mark.pnl * position.multiplier,
          ...(call?{markAsOf:asOf,markCostPerShare:mark.costPerShare,
            daysLeft:Math.max(0,(Date.parse(position.expiry)-Date.parse(asOf))/86400000),
            shortCallDelta:callSpreadShortDelta(position,asOf,bar.close,pricingVol,config.pricing,pricingVol3m),
            shortCallDeltaAtHigh:callSpreadShortDelta(position,asOf,bar.high,pricingVol,config.pricing,pricingVol3m),
            // A first-data-session terminal opening has no prior observation.
            previousCloseDelta:previousBar&&previousVol?callSpreadShortDelta(position,previousBar.date,previousBar.close,
              previousVol.pricingVol,config.pricing,previousVol.pricingVol3m):null}:{}) };
      });
      const equity = config.initialCapital + realized + unrealized;
      peak = Math.max(peak, equity); mtmMdd = Math.max(mtmMdd, peak - equity);
      const account = { cash, equity, realized, unrealized, margin, availableCash: cash - margin, mtmMdd, realizedMdd };
      curves.push({ asOf, ...account });
      return { account, observedPositions };
  };
  const adapter: BarStrategyExecutionAdapter = {
    terminalSubmission: config.terminalOpenAtClose || config.coordinated ? 'adapter' : 'omit',
    dataFingerprint: data.fingerprint,
    modelVersion: `${config.funded ? `${QQQ_SPREAD_ADAPTER_VERSION}:${JSON.stringify(config.funded)}` : QQQ_SPREAD_ADAPTER_VERSION}:terminal-close=${Boolean(config.terminalOpenAtClose)}:mark-only=${Boolean(config.terminalMarkOnly)}${config.fillRetry ? `:fill-retry=${JSON.stringify(config.fillRetry)}` : ''}${config.quantityMode ? `:quantity=${config.quantityMode}` : ''}${config.coordinated?`:coordinated=${JSON.stringify(config.coordinated)}`:''}${call?`:call-credit=${JSON.stringify(call)}`:''}${config.closingCommissionMode?`:closing-commission=${config.closingCommissionMode}`:''}${config.putTargetDtes?`:put-target-dtes=${JSON.stringify(config.putTargetDtes)}`:''}${config.putMaturityMode?`:put-maturity-mode=${config.putMaturityMode}`:''}${config.boundedPutRetryVersion?`:bounded-put-retry=${config.boundedPutRetryVersion}`:''}${config.policyMarginBudgetVersion?`:policy-margin-budget=${config.policyMarginBudgetVersion}`:''}${config.policyGroupMarginBudgetVersion?`:policy-group-margin-budget=${config.policyGroupMarginBudgetVersion}`:''}`,
    async advanceTo(asOf) {
      if(finalized)throw Error('Execution evidence is finalized');
      if (index >= 0 && !submitted) throw new Error('Previous bar was not submitted');
      if (bars[index + 1]?.date !== asOf) throw new Error('Adapter must advance through every available sample bar');
      index++; submitted = false;
      beforeBarPeaks = { peak, realizedPeak, mtmMdd, realizedMdd };
      const bar = bars[index]!, { vix, pricingVol, pricingVol3m } = vol(asOf);
      const feedback: StrategyFeedback[] = [];
      executePending(asOf, feedback);
      const { account, observedPositions } = settleAndMark(asOf, feedback);
      const chain = decisionMarket.decisionChain(asOf,bar.close,pricingVol,pricingVol3m,config.pricing,config.realStrikeGrid,config.liquidityModel,
        call?call.targetDtes.map(targetDte=>({targetDte,types:['call'] as const}))
          :config.putTargetDtes?.map(targetDte=>({targetDte,types:['put'] as const})),config.putMaturityMode?365:75);
      return { snapshot: { asOf, market: { qqq: { ...bar }, vix, vxn: data.vxnByDate[asOf] ?? null, sampleTerminal: asOf === resolvedEndDate,
        vix3m: data.vix3mByDate[asOf] ?? null, chain: chain as unknown as StrategyObject,
        executionCapabilities: { indicatorsComplete: false, commissionPerContract: config.commissionPerContract, capitalMode: config.funded ? 'funded-integer-gross-collateral'
          : call?'signal-integer-unfunded-overlay':'weighted-independent-overlay',
          impact: Boolean(config.funded), ...(config.funded ? { liquidityEvidence: config.funded.liquidityEvidence } : {}),
          ...(config.closingCommissionMode?{closingCommissionMode:config.closingCommissionMode}:{}),
          ...(config.putTargetDtes?{putTargetDtes:config.putTargetDtes}:{}),
          ...(config.putMaturityMode?{putMaturityMode:config.putMaturityMode}:{}),
          ...(config.boundedPutRetryVersion?{boundedPutRetryVersion:config.boundedPutRetryVersion}:{}),
          ...(config.policyMarginBudgetVersion?{policyMarginBudgetVersion:config.policyMarginBudgetVersion}:{}),
          ...(config.policyGroupMarginBudgetVersion?{policyGroupMarginBudgetVersion:config.policyGroupMarginBudgetVersion}:{}) } },
        account, positions: observedPositions }, feedback };
    },
    submit: (asOf,intents) => submitWithFillContracts(asOf,intents,intents.filter(i=>i.kind==='open-spread').map(i=>i.contract)),
  };
  async function submitWithFillContracts(asOf:string,intents:readonly StrategyIntent[],fillContracts:readonly StrategyObject[],
    perIntentPools:Readonly<Record<string,readonly StrategyObject[]>>={}){
      const cloned = validateSubmission(asOf, intents);
      const pool=copyStrategyData(fillContracts);
      const pools=copyStrategyData(perIntentPools);
      for(const scoped of Object.values(pools))if(!Array.isArray(scoped))throw Error('Invalid per-intent fill pool');
      for (const intent of cloned) { intentKeys.add(intent.key); pending.push({ signalDate: asOf, intent,
        fillContracts:Object.hasOwn(pools,intent.key)?pools[intent.key]!:pool }); }
      submitted = true;
      if (asOf === resolvedEndDate && (config.terminalOpenAtClose || config.coordinated) && pending.length) {
        const bar = bars[index]!, feedback: StrategyFeedback[] = [];
        executePending(asOf, feedback,true);
        // Replace the pre-decision terminal mark with its final execution account.
        ({ peak, realizedPeak, mtmMdd, realizedMdd } = beforeBarPeaks);
        curves.pop();
        const {account,observedPositions} = settleAndMark(asOf, feedback);
        return {account,positions:observedPositions,feedback};
      }
  }
  return { adapter, validateSubmission, submitWithFillContracts, decisionBars: bars.map(bar => bar.date), resolvedEndDate,
    evidence: (mode:'copy'|'seal'='copy') => {
      const book={events,curves,positions:[...positions.values()],cash,realized,
        mtmMdd,realizedMdd,assumptions:config,capabilities:{completeE209:false,productionReady:false}};
      if(mode==='copy')return finalizeExecutionBookRecords(book,'copy');
      if(index!==bars.length-1||!submitted)throw Error('Cannot finalize an incomplete execution book');
      const result=finalizeExecutionBookRecords(book,'seal');finalized=true;return result;
    } };
}
