/** Independent ownership/cash/mark reconstruction. Never used for strategy admission. */
import type { MarketDataSet } from '../engines/leveraged-overlay/v2/backtest/fixtures';
import { closePutCreditSpreadAtMark, type PutCreditSpreadPosition } from '../engines/leveraged-overlay/v2/strategies/put-credit-spread';
import { normalizeVolIndexForMockOptions } from '../engines/leveraged-overlay/backtest/mockOptions';
import type { StrategyFeedback, StrategyObject } from './strategy-module-v2';
import type { QqqSpreadAdapterConfig } from './qqq-spread-adapter-v2';
import {previousSession} from './execution-availability-v1';

export function auditSpreadAccount(data: MarketDataSet, config: QqqSpreadAdapterConfig,
  events: readonly StrategyFeedback[], accounts: readonly StrategyObject[], options: { reconstructOnly?: boolean } = {}) {
  type Position = PutCreditSpreadPosition & { multiplier: number; margin: number };
  const positions = new Map<string, Position>(), days = new Map<string, StrategyFeedback[]>();
  const bars = new Map(data.qqqBars.map(b => [b.date, b]));
  for (const event of events) { const list = days.get(event.asOf) ?? []; list.push(event); days.set(event.asOf, list); }
  let cash = config.initialCapital, realized = 0, peak = cash, realizedPeak = 0, mtmMdd = 0, realizedMdd = 0;
  let maxError = 0, maximumMargin = 0, minimumAvailableCash = cash, underfundedBars = 0;
  let maximumErrorField = '';
  let integerViolations = 0, collateralViolations = 0, capacityViolations = 0, partialFills = 0;
  const trades: StrategyObject[] = [];
  const reconstructedCurves: StrategyObject[] = [];
  for (const account of accounts) {
    const asOf = String(account.asOf), bar = bars.get(asOf);
    if (!bar) throw new Error('Audit missing market bar');
    for (const event of days.get(asOf) ?? []) {
      const p = event.payload, id = String(p.positionId);
      if (event.kind === 'reject') continue;
      cash += Number(p.weightedCashImpact);
      if (event.kind === 'fill') {
        if (positions.has(id)) throw new Error('Audit duplicate position');
        if (config.funded) {
          const quantity = Number(p.quantity), width = Number(p.shortStrike) - Number(p.longStrike);
          if (!Number.isSafeInteger(quantity) || quantity < 1 || Number(p.multiplier) !== 1) integerViolations++;
          if (Math.abs(Number(p.margin) - width * 100 * quantity) > 1e-7) collateralViolations++;
          const marginBefore = [...positions.values()].reduce((sum, own) => sum + own.margin, 0);
          if (cash - Number(p.weightedCashImpact) - marginBefore < width * 100 * quantity - 1e-7) collateralViolations++;
          if (quantity > Math.floor(Number(p.strikeVolume) * config.funded.participationRate)
            || quantity > config.funded.maxContractsPerOrder || quantity > Math.floor(Number(p.requestedMultiplier))) capacityViolations++;
          const quoteDate=config.terminalOpenAtClose&&asOf===String(accounts.at(-1)?.asOf)&&p.signalDate===asOf?asOf:previousSession(data,asOf);
          const vix = data.vixByDate[quoteDate], vxn = data.vxnByDate[quoteDate];
          const vol = vxn === undefined ? vix : normalizeVolIndexForMockOptions(vxn, 'VXN');
          const raw3m = data.vix3mByDate[quoteDate], vol3m = raw3m === undefined ? undefined : raw3m * (vol / vix);
          const openingEquity = config.initialCapital + realized + [...positions.values()].reduce((sum, own) => sum
            + closePutCreditSpreadAtMark(own, asOf,quoteDate===asOf?bar.close:bar.open, vol, 'independent-funding', config.pricing, vol3m).pnl * own.multiplier, 0);
          if (width * 100 * quantity > Math.max(0, openingEquity) * config.funded.maxOrderRiskFraction + 1e-7) capacityViolations++;
          if (p.partialFill === true) partialFills++;
        }
        positions.set(id, { underlying: 'QQQ', expiry: String(p.expiry), shortStrike: Number(p.shortStrike), longStrike: Number(p.longStrike),
          width: Number(p.shortStrike) - Number(p.longStrike), quantity: Number(p.quantity), creditReceived: Number(p.cashImpact),
          multiplier: Number(p.multiplier), margin: Number(p.margin) });
      } else {
        const own = positions.get(id); if (!own) throw new Error('Audit close has no owned opening');
        const pnl = (own.creditReceived + Number(p.cashImpact)) * own.multiplier;
        maxError = Math.max(maxError, Math.abs(pnl - Number(p.pnl)));
        realized += pnl; trades.push({ ...p, closeDate: event.asOf, pnl }); positions.delete(id);
      }
    }
    const vix = data.vixByDate[asOf], vxn = data.vxnByDate[asOf];
    const vol = vxn === undefined ? vix : normalizeVolIndexForMockOptions(vxn, 'VXN');
    const raw3m = data.vix3mByDate[asOf], vol3m = raw3m === undefined ? undefined : raw3m * (vol / vix);
    const unrealized = [...positions.values()].reduce((sum, p) => sum + closePutCreditSpreadAtMark(p, asOf,
      bar.close, vol, 'independent-audit', config.pricing, vol3m).pnl * p.multiplier, 0);
    const equity = config.initialCapital + realized + unrealized;
    const margin = [...positions.values()].reduce((sum, p) => sum + p.margin, 0), availableCash = cash - margin;
    peak = Math.max(peak, equity); mtmMdd = Math.max(mtmMdd, peak - equity);
    realizedPeak = Math.max(realizedPeak, realized); realizedMdd = Math.max(realizedMdd, realizedPeak - realized);
    for (const [key, value] of Object.entries({ cash, realized, unrealized, equity, margin, availableCash, mtmMdd, realizedMdd })) {
      if (options.reconstructOnly) continue;
      const observed = Number(account[key]);
      if (!Number.isFinite(value) || !Number.isFinite(observed)) throw new Error('Non-finite audit accounting');
      const error = Math.abs(value - observed);
      if (error > maxError) { maxError = error; maximumErrorField = `${asOf}:${key}`; }
    }
    reconstructedCurves.push({ asOf, cash, realized, unrealized, equity, margin, availableCash, mtmMdd, realizedMdd });
    maximumMargin = Math.max(maximumMargin, margin); minimumAvailableCash = Math.min(minimumAvailableCash, availableCash);
    if (availableCash < 0) underfundedBars++;
  }
  return { status: maxError < 1e-7 && (!positions.size || config.terminalMarkOnly) && !integerViolations && !collateralViolations && !capacityViolations
      && (!config.funded || !underfundedBars) ? 'ACCOUNT_MTM_PASS' : 'ACCOUNT_MTM_FAIL',
    maxError, maximumErrorField, openPositions: positions.size, trades, pl: realized, mtmMdd, realizedMdd,
    ...(options.reconstructOnly ? { reconstructedCurves } : {}),
    capacity: { maximumMargin, minimumAvailableCash, underfundedBars, fundedLiveCapacityValidated: false,
      ...(config.funded ? { integerViolations, collateralViolations, capacityViolations, partialFills,
        modeledIntegerExecutionValidated: integerViolations + collateralViolations + capacityViolations + underfundedBars === 0,
        liquidityEvidence: config.funded.liquidityEvidence } : {}) } };
}
