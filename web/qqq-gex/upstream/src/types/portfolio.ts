import { StrategyWithLegs, TradeWarning } from './strategy';
import type { FactorMap } from './factor';

/**
 * A generalized adapter for any strategy with real-time tracking data.
 * Extends the base StrategyWithLegs with computed fields for UI consumption.
 */
export interface LiveStrategyAdapter extends StrategyWithLegs {
  // Common identifiers
  symbol: string;
  isClosed: boolean;
  
  // Dates
  openDate: string;
  expDate: string;
  closeDate?: string;
  duration?: number; // Days held or to be held

  // Pricing & PnL
  underlyingPrice: number; // Entry or reference price
  currentPrice?: number;   // Real-time underlying price
  premiumTotal: number;    // Total net premium (entry)
  actualPnL?: number;      // Realized PnL
  livePnL?: number;        // Unrealized PnL based on current market
  
  // Performance Metrics
  expectedAPR?: number;
  maxAPR?: number;
  actualAPR?: number;
  currentAPR?: number;

  // Real-time Greeks & Option Data (Aggregate or main leg)
  currentIV?: number | null;
  currentDelta?: number;
  currentTheta?: number;
  currentOptionPrice?: number;
  currentBid?: number;
  currentAsk?: number;
  currentMid?: number;

  // CSP Specific (Can be optional for other strategies)
  strike?: number;
  premium?: number;
  qty?: number;
  expectedAssignmentCost?: number;
  premiumPct?: number;
  takeProfit70?: number;
  
  // Warnings
  warnings?: TradeWarning[];
}

export interface PortfolioSummary {
  realizedPnL: number;
  unrealizedPnL: number;
  activePremium: number;
  projectedTotalProfit: number;
  totalTheta: number;
  totalDelta: number;
  winRate: number;
  activeCount: number;
  /** 因子化汇总；旧的数值字段保留给现有展示适配器。 */
  factors: FactorMap;
}
