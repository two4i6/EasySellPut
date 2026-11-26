import type { FactorMap, FinancialFactor } from '../../../types/factor';

export type DailyRegime = 'BULL' | 'RISK_ON_EXTENDED' | 'RISK_ON_WEAKENING' | 'SIDEWAYS' | 'BEAR' | 'CRISIS' | 'RANGE_BOUND';

export type IntradayBar = {
  timestamp: string;
  open: FinancialFactor<number>;
  high: FinancialFactor<number>;
  low: FinancialFactor<number>;
  close: FinancialFactor<number>;
  volume: FinancialFactor<number>;
};

export type IntradayInput = {
  mode: 'live' | 'replay';
  asOf: string; // 由调用方传入；禁止直接 Date.now，保证幂等
  bars: IntradayBar[];
  dailyRegime: DailyRegime;
  dailySupport: FinancialFactor<number>;
  dailyAtr: FinancialFactor<number>;
  account: {
    netLiquidation: FinancialFactor<number>;
  };
  state?: LadderState;
  contextFactors?: FactorMap;
};

export type LadderSlot = {
  id: string;                 // 固定 L0-1、L0-2、…，保证幂等
  level: 'L0' | 'L1' | 'L2';
  openedAt: string;
  barDate: string;
  entryPrice: FinancialFactor<number>;
  targetPrice: FinancialFactor<number>;
  budgetAmount: FinancialFactor<number>;
};

export type LadderState = {
  slots: LadderSlot[];
};

export type LadderProposal = {
  slotId: string;
  level: 'L0' | 'L1' | 'L2';
  executionStatus: 'CANDIDATE_ONLY';
  action: 'BUY' | 'SELL';
  price: FinancialFactor<number>;
  reason: string;
  confidence: number;
};

export type LadderOutput = {
  factors: FactorMap;
  proposals: LadderProposal[];
  nextState: LadderState;
  blocked?: boolean;
  reasons: string[];
};
