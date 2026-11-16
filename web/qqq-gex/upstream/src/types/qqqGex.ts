import type { FactorMap, FinancialFactor } from './factor';
import type { QqqGammaPositionLevel } from '@/lib/qqqGammaPosition';
import type { QqqGammaModel } from '@/lib/qqqGammaModel';
import type { TerminalFactorView } from '@/lib/engines/analysis/QqqGexTerminalEngine';
import type { QqqGexResearchSurface } from '@/lib/engines/analysis/QqqGexResearch';
import type { QqqIntradayDirectionalDecision } from '@/lib/engines/analysis/QqqIntradayDirectional';
import type { QqqIntradayDirectionalGradeStats, QqqIntradayDirectionalReplayResult, QqqIntradayDirectionalValidation, QqqIntradayDirectionalReplaySignal } from '@/lib/engines/analysis/QqqIntradayDirectionalReplay';
import type { QqqStrategyProbabilityContext } from '@/lib/engines/analysis/QqqStrategyAnalysis';

// Shared wire/display contract. No component or browser runtime dependencies.
export type PcsGexProfile = { strike: number; magnitude: number; isCallWall: boolean; isPutWall: boolean; isGammaFlip: boolean };
export type PcsFullGexProfile = { callInputComplete?: boolean; putInputComplete?: boolean; computedAt?: string; callReceivedAt?: string; putReceivedAt?: string; sourceAsOf?: string; inputComplete?: boolean; calculationVersion?: string; gexUnit?: string; strike: number; callGex: number; putGex: number; totalGex: number; callOi?: number; putOi?: number; callVolume?: number; putVolume?: number; callBid?: number; callAsk?: number; callMid?: number; callLast?: number; callIv?: number; callDelta?: number; callGamma?: number; putBid?: number; putAsk?: number; putMid?: number; putLast?: number; putIv?: number; putDelta?: number; putGamma?: number; isCallWall: boolean; isPutWall: boolean; isGammaFlip: boolean };
export type PcsGexExpiry = {
  asOf: string; expiryDate: string; dte: number; gex: Array<{ time: string; totalGex: number; gammaFlipLevel: number | null }>; gexProfile: PcsGexProfile[]; gexProfileHistory: Array<{ time: string; strikes: PcsGexProfile[] }>;
  fullGexProfile: PcsFullGexProfile[]; fullGexProfileHistory: Array<{ time: string; strikes: PcsFullGexProfile[]; strikeCoverage?: 'full' | 'top8' }>;
  gexSummary: { king: { strike: number; magnitude: number; side: 'call' | 'put' } | null; callWall: { strike: number; magnitude: number } | null; putWall: { strike: number; magnitude: number } | null; gammaFlip: number | null; netGex: number; callTotal: number; putTotal: number } | null;
  wallHistory: Array<{ time: string; callWallPrice: number | null; putWallPrice: number | null; callWallMagnitude?: number | null; putWallMagnitude?: number | null; kingStrike?: number | null; kingMagnitude?: number | null; kingSide?: 'call' | 'put' | null }>;
  terminal?: TerminalFactorView;
  research?: QqqGexResearchSurface | null;
};

export type QqqPcsApiResponse = {
  observedAt?: string;
  symbol: 'QQQ'; asOf: string; view: { mode: 'live' | 'historical'; date: string | null }; intraday: { gammaPositionHistory?: QqqGammaPositionLevel[]; gammaModels?: { selected: QqqGammaModel; available: QqqGammaModel }; granularity: '2m' | '5m' | '1d'; session: 'PREMARKET' | 'REGULAR' | 'POSTMARKET' | 'DAILY'; bars: Array<{ timestamp: string; close: number; volume: number; open?: number; high?: number; low?: number }>; extendedHoursBars?: Array<{ timestamp: string; close: number; volume: number; open?: number; high?: number; low?: number }>; scoreSeries: Array<{ time: string; score: number }>; gex?: Array<{ date: string; totalGex: number; gammaFlipLevel: number | null } | { time: string; totalGex: number; gammaFlipLevel: number | null }>; gexProfile?: PcsGexProfile[]; gexProfileHistory?: Array<{ time: string; strikes: PcsGexProfile[] }>; gexSummary?: PcsGexExpiry['gexSummary']; wallHistory?: PcsGexExpiry['wallHistory']; gexExpiries?: PcsGexExpiry[]; gexAsOf?: string | null; terminal?: TerminalFactorView | null; directional?: { liveStatus?: { available: boolean; reason: string | null }; current: QqqIntradayDirectionalDecision; signals: QqqIntradayDirectionalDecision[]; outcomes?: QqqIntradayDirectionalReplaySignal[] }; gexInsights?: { gammaRegime: { label: 'positive' | 'negative'; description: string; distance: number; distancePct: number } | null; wallDistances: { callWall: { strike: number; distance: number; distancePct: number } | null; putWall: { strike: number; distance: number; distancePct: number } | null }; wallStability: { callWall: { segments: number; currentSegmentMinutes: number | null; sparse: boolean; description: string } | null; putWall: { segments: number; currentSegmentMinutes: number | null; sparse: boolean; description: string } | null } | null; candidateProximity: { strike: number; wallStrike: number; wallSide: 'call' | 'put'; distancePoints: number; close: boolean; description: string } | null; topology: { structure: string; gloss: string } | null } | null } | null; intradaySessionAsOf: string | null; dataStatus: 'LIVE' | 'STALE' | 'INSUFFICIENT'; dataIssues: string[];
  daily: { eligibility: FinancialFactor<'OPEN' | 'WATCH' | 'BLOCK' | 'UNAVAILABLE'>; reasons: string[]; phase: 'PREMARKET' | 'PRELIMINARY' | 'CLOSED'; asOf: string | null; priceBasis: 'PREMARKET' | 'PREVIOUS_CLOSE'; confirmation: FinancialFactor<number> };
  regime: { mode: 'unified' | 'overlay' | 'compare'; selectedEngine: 'unified' | 'overlay'; unified: string | null; overlay: string | null; disagreement: boolean };
  timing: FinancialFactor<'NOW' | 'WAIT_PULLBACK' | 'WAIT_CONFIRM' | 'NO_ENTRY_SIGNAL' | 'INSUFFICIENT_DATA'>;
  lifecycle: { available: boolean; points: Array<{ time: string; score: number; timing: 'NOW' | 'WAIT_PULLBACK' | 'WAIT_CONFIRM' | 'NO_ENTRY_SIGNAL' | 'INSUFFICIENT_DATA'; contract: { status: 'READY'; expiry: string; daysToExpiration: number; sigma: number; shortStrike: number; longStrike: number; netCredit: number; annualizedReturn: number } | { status: 'UNAVAILABLE'; reason: string } | null }> };
  factors: FactorMap;
  candidate:
    | { status: 'READY'; source: 'live_chain' | 'historical_model'; expiry: string; daysToExpiration: number; sigma: number; sigmaReason: string; shortStrike: number; longStrike: number; width: number; netCredit: number; slippage: number; definedRisk: number; annualizedReturn: number; minOpenInterest: number; minVolume: number; model: { expiry: string; daysToExpiration: number; shortStrike: number; longStrike: number } }
    | { status: 'UNAVAILABLE'; reason: string };
  syntheticCandidate?: { status: 'READY'; source: 'synthetic_research'; expiry: string; daysToExpiration: number; sigma: number; sigmaReason: string; shortStrike: number; longStrike: number; width: number; netCredit: number; slippage: number; definedRisk: number; annualizedReturn: number; minOpenInterest: number; minVolume: number; model: { expiry: string; daysToExpiration: number; shortStrike: number; longStrike: number } } | null;
  probabilityContext?: QqqStrategyProbabilityContext;
};


export type QqqDirectionalReplayApiResponse = {
  policyVersion: string;
  discovery: true;
  source?: 'RAW_REPLAY' | 'DAILY_SUMMARY';
  totalSignals: number;
  completeDays: number;
  signalDays: number;
  dailyCoverageRate: number | null;
  gradeStats: QqqIntradayDirectionalGradeStats;
  opportunityStats: QqqIntradayDirectionalReplayResult['opportunityStats'];
  lifecycleStats: QqqIntradayDirectionalReplayResult['lifecycleStats'];
  groupedStats: QqqIntradayDirectionalReplayResult['groupedStats'];
  riskStats: QqqIntradayDirectionalReplayResult['riskStats'];
  sessionStats: QqqIntradayDirectionalReplayResult['sessionStats'];
  funnel: QqqIntradayDirectionalReplayResult['funnel'];
  dailyStats: QqqIntradayDirectionalReplayResult['dailyStats'];
  fingerprint: string;
  repeatedFingerprint: string;
  validation: QqqIntradayDirectionalValidation;
  items: QqqIntradayDirectionalReplaySignal[];
};

