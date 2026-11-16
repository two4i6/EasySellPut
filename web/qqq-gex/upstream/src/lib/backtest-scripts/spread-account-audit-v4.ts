/** Independent ownership/cash/mark reconstruction. Never used for strategy admission. */
import type { MarketDataSet } from '../engines/leveraged-overlay/v2/backtest/fixtures';
import { closePutCreditSpreadAtMark, type PutCreditSpreadPosition } from './put-spread-kernel-v6';
import { normalizeVolIndexForMockOptions,listedExpiries,strikesFor,quoteOptionStrike,effectiveVix,dividendYieldForSymbol } from '../engines/leveraged-overlay/backtest/mockOptions';
import {closeCallSpreadAtMark,finalizeCallSpread} from './call-spread-mark-v1';
import type { StrategyFeedback, StrategyObject } from './strategy-module-v2';
import type { QqqSpreadAdapterConfig } from './qqq-spread-adapter-v2';
import { previousSession } from './execution-availability-v1';

export type SpreadAccountAudit = ReturnType<typeof import('./spread-account-audit-v3').auditSpreadAccount>;
export type SpreadAccountAuditOptions = { reconstructOnly?: boolean };
export interface PreTerminalAccountPhase {
  /** Actual delivered accounts, including the last pre-submission account. */
  accounts: readonly StrategyObject[];
  /** IDs in this book's event namespace; must identify the final day's suffix. */
  terminalEventIds: ReadonlySet<string>;
}
/** Compatible single-account audit; arithmetic and returned field order match v3. */
export function auditSpreadAccount(data: MarketDataSet, config: QqqSpreadAdapterConfig,
  events: readonly StrategyFeedback[], accounts: readonly StrategyObject[], options: SpreadAccountAuditOptions = {}) {
  return traverse(data, config, events, accounts, options).audit;
}

/** One independent event traversal, two validations; no execution pricing cache input. */
export function auditSpreadAccountWithTerminalPhase(data: MarketDataSet, config: QqqSpreadAdapterConfig,
  events: readonly StrategyFeedback[], accounts: readonly StrategyObject[], phase: PreTerminalAccountPhase,
  options: SpreadAccountAuditOptions = {}) {
  validatePhase(events, accounts, phase);
  const result = traverse(data, config, events, accounts, options, phase);
  return { audit: result.audit, preTerminalAudit: result.preTerminalAudit! };
}

function validatePhase(events: readonly StrategyFeedback[], accounts: readonly StrategyObject[], phase: PreTerminalAccountPhase) {
  if (!accounts.length || phase.accounts.length !== accounts.length
    || accounts.some((a, i) => String(a.asOf) !== String(phase.accounts[i]!.asOf)
      || (i > 0 && String(a.asOf) <= String(accounts[i - 1]!.asOf))))
    throw new Error('Audit terminal phase requires matching chronological accounts');
  const last = String(accounts.at(-1)!.asOf);
  let suffix = false;
  const found = new Set<string>();
  for (const event of events) {
    if (phase.terminalEventIds.has(event.id)) {
      if (event.asOf !== last || found.has(event.id)) throw new Error('Audit invalid terminal event');
      found.add(event.id); suffix = true;
    } else if (suffix) throw new Error('Audit terminal events must be a suffix');
  }
  if (found.size !== phase.terminalEventIds.size) throw new Error('Audit missing terminal event');
}

function traverse(data: MarketDataSet, config: QqqSpreadAdapterConfig,
  events: readonly StrategyFeedback[], accounts: readonly StrategyObject[], options: SpreadAccountAuditOptions,
  phase?: PreTerminalAccountPhase) {
  type Position = PutCreditSpreadPosition & { multiplier: number; margin: number; executionPolicy?:string };
  const call=config.callCreditSpread;
  const closeAtMark=call?closeCallSpreadAtMark:closePutCreditSpreadAtMark;
  const positions = new Map<string, Position>(), days = new Map<string, StrategyFeedback[]>();
  const bars = new Map(data.qqqBars.map(b => [b.date, b]));
  for (const event of events) { const list = days.get(event.asOf) ?? []; list.push(event); days.set(event.asOf, list); }
  let cash = config.initialCapital, realized = 0;
  const metrics = { peak: cash, realizedPeak: 0, mtmMdd: 0, realizedMdd: 0,
    maxError: 0, maximumMargin: 0, minimumAvailableCash: cash, underfundedBars: 0,
    maximumErrorField: '', integerViolations: 0, collateralViolations: 0, capacityViolations: 0, partialFills: 0 };
  type Accumulators = typeof metrics;
  const trades: StrategyObject[] = [];
  const reconstructedCurves: StrategyObject[] = [];
  let currentReconstruction: StrategyObject;
  let preMaxError = 0, preErrorField = '', eventMaxError = 0;
  let preTerminalAudit: SpreadAccountAudit | undefined;
  function applyEvent(event: StrategyFeedback, asOf: string) {
    const bar = bars.get(asOf)!;
    const p = event.payload, id = String(p.positionId);
    if (event.kind === 'reject') return;
    cash += Number(p.weightedCashImpact);
    if (event.kind === 'fill') {
      if (positions.has(id)) throw new Error('Audit duplicate position');
      if(call){
        const quantity=Number(p.quantity),width=Number(p.longStrike)-Number(p.shortStrike);
        if(p.type!=='call'||!(width>0)||!Number.isFinite(width)||!Number.isSafeInteger(quantity)||quantity<1||quantity>100_000
          ||p.multiplier!==1||!call.targetDtes.includes(Number(p.targetDte)))throw Error('Audit invalid call contract/quantity');
        const terminal=p.executionTime==='close'&&asOf===String(accounts.at(-1)?.asOf)&&p.signalDate===asOf;
        if((terminal&&!config.terminalOpenAtClose)||(!terminal&&(String(p.signalDate)!==previousSession(data,asOf)||p.executionTime!=='open')))
          throw Error('Audit invalid call fill availability');
        const quoteDate=terminal?asOf:previousSession(data,asOf),spot=terminal?bar.close:bar.open;
        if(p.quoteAsOf!==quoteDate)throw Error('Audit invalid call volatility availability');
        const vix=data.vixByDate[quoteDate],vxn=data.vxnByDate[quoteDate];
        const vol=vxn===undefined?vix:normalizeVolIndexForMockOptions(vxn,'VXN');
        const raw3m=data.vix3mByDate[quoteDate],vol3m=raw3m===undefined?undefined:raw3m*(vol/vix);
        const expiries=listedExpiries(asOf,75,'QQQ'),expiry=String(p.expiry);
        const pricingExpiry=expiries.includes(expiry)?expiry:expiries.reduce((best,e)=>
          Math.abs((Date.parse(e)-Date.parse(asOf))/86400000-Number(p.targetDte))
            <Math.abs((Date.parse(best)-Date.parse(asOf))/86400000-Number(p.targetDte))?e:best);
        const days=(Date.parse(pricingExpiry)-Date.parse(asOf))/86400000;
        const listed=new Set(strikesFor('QQQ',spot,config.realStrikeGrid));
        if(!listed.has(Number(p.shortStrike))||!listed.has(Number(p.longStrike)))throw Error('Audit unlisted call strike');
        const quote=(strike:number)=>quoteOptionStrike({symbol:'QQQ',rawSpot:spot,rawStrike:strike,pricingYears:days/365,
          effectiveVol:effectiveVix(vol,vol3m,days),riskFreeRate:config.pricing.riskFreeRate,skewSlope:config.pricing.skewSlope,
          spreadMultiplier:config.pricing.spreadMultiplier,dividendYield:dividendYieldForSymbol('QQQ')}).call;
        const expectedPerContract=(quote(Number(p.shortStrike)).bid-quote(Number(p.longStrike)).ask)*100;
        const expectedCredit=expectedPerContract*quantity
          -2*quantity*config.commissionPerContract;
        checkEventError(expectedPerContract-Number(p.creditPerContract));
        checkEventError(expectedCredit-Number(p.cashImpact));
        checkEventError(Number(p.cashImpact)-Number(p.weightedCashImpact));
        checkEventError((width*100*quantity-expectedCredit)-Number(p.margin));
      }
      if(config.coordinated){
        const policy=typeof p.executionPolicy==='string'?config.coordinated.policies[p.executionPolicy]:undefined;
        if(!policy)throw Error('Audit unknown coordinated execution policy');
        if(!Number.isSafeInteger(p.quantity)||Number(p.quantity)<1
          ||(!policy.quantityMode&&p.quantity!==1))throw Error('Audit coordinated quantity mismatch');
        if(p.signalDate===asOf&&!policy.terminalOpenAtClose)throw Error('Audit unsupported terminal opening');
      }
      if (config.funded) {
        const quantity = Number(p.quantity), width = Number(p.shortStrike) - Number(p.longStrike);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || Number(p.multiplier) !== 1) metrics.integerViolations++;
        if (Math.abs(Number(p.margin) - width * 100 * quantity) > 1e-7) metrics.collateralViolations++;
        const marginBefore = [...positions.values()].reduce((sum, own) => sum + own.margin, 0);
        if (cash - Number(p.weightedCashImpact) - marginBefore < width * 100 * quantity - 1e-7) metrics.collateralViolations++;
        if (quantity > Math.floor(Number(p.strikeVolume) * config.funded.participationRate)
          || quantity > config.funded.maxContractsPerOrder || quantity > Math.floor(Number(p.requestedMultiplier))) metrics.capacityViolations++;
        const quoteDate=config.terminalOpenAtClose&&asOf===String(accounts.at(-1)?.asOf)&&p.signalDate===asOf?asOf:previousSession(data,asOf);
        const vix = data.vixByDate[quoteDate], vxn = data.vxnByDate[quoteDate];
        const vol = vxn === undefined ? vix : normalizeVolIndexForMockOptions(vxn, 'VXN');
        const raw3m = data.vix3mByDate[quoteDate], vol3m = raw3m === undefined ? undefined : raw3m * (vol / vix);
        const openingEquity = config.initialCapital + realized + [...positions.values()].reduce((sum, own) => sum
          + closeAtMark(own, asOf,quoteDate===asOf?bar.close:bar.open, vol, 'independent-funding', config.pricing, vol3m).pnl * own.multiplier, 0);
        if (width * 100 * quantity > Math.max(0, openingEquity) * config.funded.maxOrderRiskFraction + 1e-7) metrics.capacityViolations++;
        if (p.partialFill === true) metrics.partialFills++;
      }
      positions.set(id, { underlying: 'QQQ', expiry: String(p.expiry), shortStrike: Number(p.shortStrike), longStrike: Number(p.longStrike),
        width: call?Number(p.longStrike)-Number(p.shortStrike):Number(p.shortStrike) - Number(p.longStrike), quantity: Number(p.quantity), creditReceived: Number(p.cashImpact),
        multiplier: Number(p.multiplier), margin: Number(p.margin),
        ...(config.coordinated?{executionPolicy:String(p.executionPolicy)}:{}) });
    } else {
      const own = positions.get(id); if (!own) throw new Error('Audit close has no owned opening');
      if(call){
        if(p.expiry!==own.expiry||p.quantity!==own.quantity||p.multiplier!==1
          ||p.shortStrike!==own.shortStrike||p.longStrike!==own.longStrike)throw Error('Audit call closing ownership mismatch');
        const settled=event.kind==='settle',terminal=asOf===String(accounts.at(-1)?.asOf)&&p.executionTime==='close';
        if(p.type!=='call'||(settled&&(own.expiry>asOf||p.executionTime!=='close'))
          ||(!settled&&p.executionTime!=='open'&&!terminal))throw Error('Audit invalid call settlement');
        const quoteDate=settled||terminal?asOf:previousSession(data,asOf);
        if(p.quoteAsOf!==quoteDate)throw Error('Audit invalid call closing volatility availability');
        const vix=data.vixByDate[quoteDate],vxn=data.vxnByDate[quoteDate];
        const vol=vxn===undefined?vix:normalizeVolIndexForMockOptions(vxn,'VXN');
        const raw3m=data.vix3mByDate[quoteDate],vol3m=raw3m===undefined?undefined:raw3m*(vol/vix);
        const expected=settled?finalizeCallSpread({position:own,asOfDate:asOf,qqqClose:bar.close,vix:vol,vix3m:vol3m,
          pricing:config.pricing,commission:settled?0:2*own.quantity*config.commissionPerContract})
          :closeCallSpreadAtMark(own,asOf,terminal?bar.close:bar.open,vol,'independent-close',config.pricing,vol3m);
        checkEventError(expected.cashImpact-(settled?0:2*own.quantity*config.commissionPerContract)-Number(p.cashImpact));
        checkEventError(Number(p.cashImpact)-Number(p.weightedCashImpact));
      }
      const pnl = (own.creditReceived + Number(p.cashImpact)) * own.multiplier;
      const error = Math.abs(pnl - Number(p.pnl));
      metrics.maxError = Math.max(metrics.maxError, error); eventMaxError = Math.max(eventMaxError, error);
      realized += pnl; trades.push({ ...p, closeDate: event.asOf, pnl }); positions.delete(id);
    }
  }
  function checkEventError(difference:number){
    if(!Number.isFinite(difference))throw Error('Non-finite call accounting');
    const error=Math.abs(difference);metrics.maxError=Math.max(metrics.maxError,error);eventMaxError=Math.max(eventMaxError,error);
  }
  for (let index = 0; index < accounts.length; index++) {
    const account = accounts[index]!;
    const asOf = String(account.asOf), bar = bars.get(asOf);
    if (!bar) throw new Error('Audit missing market bar');
    const daily = days.get(asOf) ?? [];
    const boundary = phase && index === accounts.length - 1 ? daily.length - phase.terminalEventIds.size : daily.length;
    for (let i = 0; i < boundary; i++) applyEvent(daily[i]!, asOf);
    if (phase && index === accounts.length - 1) {
      // Checkpoint marking operates on a private accumulator, never the full peaks.
      const checkpoint = { ...metrics, maxError: Math.max(preMaxError, eventMaxError), maximumErrorField: preErrorField };
      mark(phase.accounts[index]!, checkpoint);
      preTerminalAudit = result(checkpoint);
      if(options.reconstructOnly)reconstructedCurves.pop();
    }
    for (let i = boundary; i < daily.length; i++) applyEvent(daily[i]!, asOf);
    mark(account, metrics);
    if (phase && index < accounts.length - 1) {
      preMaxError = Math.max(preMaxError, eventMaxError);
      const comparison = compare(phase.accounts[index]!, currentReconstruction!, preMaxError, preErrorField);
      preMaxError = comparison.maxError; preErrorField = comparison.maximumErrorField;
    }
  }
  return { audit: result(metrics), ...(phase ? { preTerminalAudit: preTerminalAudit! } : {}) };

  function mark(account: StrategyObject, metrics: Accumulators) {
    const asOf = String(account.asOf), bar = bars.get(asOf)!;
    const vix = data.vixByDate[asOf], vxn = data.vxnByDate[asOf];
    const vol = vxn === undefined ? vix : normalizeVolIndexForMockOptions(vxn, 'VXN');
    const raw3m = data.vix3mByDate[asOf], vol3m = raw3m === undefined ? undefined : raw3m * (vol / vix);
    const unrealized = [...positions.values()].reduce((sum, p) => sum + closeAtMark(p, asOf,
      bar.close, vol, 'independent-audit', config.pricing, vol3m).pnl * p.multiplier, 0);
    const equity = config.initialCapital + realized + unrealized;
    const margin = [...positions.values()].reduce((sum, p) => sum + p.margin, 0), availableCash = cash - margin;
    metrics.peak = Math.max(metrics.peak, equity); metrics.mtmMdd = Math.max(metrics.mtmMdd, metrics.peak - equity);
    metrics.realizedPeak = Math.max(metrics.realizedPeak, realized); metrics.realizedMdd = Math.max(metrics.realizedMdd, metrics.realizedPeak - realized);
    const comparison = compare(account, { cash, realized, unrealized, equity, margin, availableCash, mtmMdd: metrics.mtmMdd, realizedMdd: metrics.realizedMdd }, metrics.maxError, metrics.maximumErrorField);
    metrics.maxError = comparison.maxError; metrics.maximumErrorField = comparison.maximumErrorField;
    currentReconstruction={ asOf, cash, realized, unrealized, equity, margin, availableCash, mtmMdd: metrics.mtmMdd, realizedMdd: metrics.realizedMdd };
    if(options.reconstructOnly)reconstructedCurves.push(currentReconstruction);
    metrics.maximumMargin = Math.max(metrics.maximumMargin, margin); metrics.minimumAvailableCash = Math.min(metrics.minimumAvailableCash, availableCash);
    if (availableCash < 0) metrics.underfundedBars++;
  }
  function result(metrics: Accumulators) { return { status: metrics.maxError < 1e-7
      && (!positions.size || (config.coordinated
        ? [...positions.values()].every(p=>config.coordinated!.policies[p.executionPolicy!]?.terminalMarkOnly===true)
        : config.terminalMarkOnly)) && !metrics.integerViolations && !metrics.collateralViolations && !metrics.capacityViolations
      && (!config.funded || !metrics.underfundedBars) ? 'ACCOUNT_MTM_PASS' : 'ACCOUNT_MTM_FAIL',
    maxError: metrics.maxError, maximumErrorField: metrics.maximumErrorField, openPositions: positions.size, trades: [...trades], pl: realized, mtmMdd: metrics.mtmMdd, realizedMdd: metrics.realizedMdd,
    ...(options.reconstructOnly ? { reconstructedCurves: [...reconstructedCurves] } : {}),
    capacity: { maximumMargin: metrics.maximumMargin, minimumAvailableCash: metrics.minimumAvailableCash, underfundedBars: metrics.underfundedBars, fundedLiveCapacityValidated: false,
      ...(config.funded ? { integerViolations: metrics.integerViolations, collateralViolations: metrics.collateralViolations, capacityViolations: metrics.capacityViolations, partialFills: metrics.partialFills,
        modeledIntegerExecutionValidated: metrics.integerViolations + metrics.collateralViolations + metrics.capacityViolations + metrics.underfundedBars === 0,
        liquidityEvidence: config.funded.liquidityEvidence } : {}) } };
  }

  function compare(account: StrategyObject, values: StrategyObject, maxError: number, maximumErrorField: string) {
    for (const [key, value] of Object.entries(values)) {
      if (options.reconstructOnly || key === 'asOf') continue;
      const observed = Number(account[key]);
      if (!Number.isFinite(value) || !Number.isFinite(observed)) throw new Error('Non-finite audit accounting');
      const error = Math.abs(Number(value) - observed);
      if (error > maxError) { maxError = error; maximumErrorField = `${account.asOf}:${key}`; }
    }
    return { maxError, maximumErrorField };
  }
}
