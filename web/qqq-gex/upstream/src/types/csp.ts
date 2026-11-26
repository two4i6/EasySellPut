import { FinancialFactor } from './factor';
import { VerdictAction, StrategyType, TriggerCondition, UnifiedRegime, TimingState, RiskLevel } from '../lib/engines';
import { StrategyWithLegs, TradeWarning } from './strategy';
import { LiveStrategyAdapter } from './portfolio';

export type CSPAction = 'SELL_PUT' | 'WAIT' | 'ROLL' | 'CLOSE' | 'FORCE_EXIT';

export interface CSPTradeAdapter extends LiveStrategyAdapter {
  // CSP Specific mandatory fields (overriding optional fields in base)
  strike: number;
  premium: number;
  qty: number;
  duration: number;
  expectedAPR: number;
  maxAPR: number;
  premiumPct: number;
  takeProfit70: number;
  
  // CSP Specific extensions
  closeCost?: number;
}

export interface CSPDecisionValue {
  action: CSPAction;
  strategy: StrategyType;
  color: string;
  reason: string;
  reasonKeys?: string[];
  marketLabels: string[];
  confidence: number;
  riskScore: number;
  realRisk: number;
  
  // Optional / Specific to CSP
  strike?: number;
  dte?: number;
  delta?: number;
  premium?: number;
  isITM?: boolean;
  profitProgress?: number;

  // Compatibility with DecisionSystem
  positionSize?: number;
  sizeLabel?: string;
  triggerConditions?: TriggerCondition[];
  regime?: UnifiedRegime;
  analysisReasons: {
    iv: string[];
    timing: string[];
    risk: string[];
    conflict: string[];
  };
}

export interface CSPDecisionSystem {
  decision: FinancialFactor<CSPDecisionValue>;
  riskWarning: FinancialFactor<string | null>;
  recommendation: FinancialFactor<any>;
  metrics: {
    opportunity: FinancialFactor<any>;
    timing: FinancialFactor<any>;
  };
  exitRules: FinancialFactor<{ type: string; rule: string }[]>;
  magi: {
    scientist: FinancialFactor<string>;
    macro: FinancialFactor<string>;
    opportunist: FinancialFactor<string>;
  };
}

export interface KCResult {
  upper: number;
  middle: number;
  lower: number;
}
