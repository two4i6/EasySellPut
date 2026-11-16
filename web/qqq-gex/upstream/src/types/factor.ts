/*
 * Copyright (c) 2026 by ${git_name_email} JE Solution Co., All Rights Reserved. 
 */
import type { HMMResult, GEXTopology, SigmaEventOutput } from '../lib/engines';
import type { IVCurveValue } from './ivCurve';

export type FactorId = string;

export type RawSource = {
  type: "raw";
  api: string;
};

export type DerivedSource = {
  type: "derived";
  // 只存 factorId 和 weight，confidence 运行时从 FactorMap 动态读取
  // weight 之和必须为 1.0，由 validateWeights() 在运行时强制校验
  inputs: {
    factorId: FactorId;
    weight: number;
  }[];
};

export type FallbackSource = {
  type: "fallback";
  reason: string;
};

export type ManualSource = {
  type: "manual";
  description: string;
};

export type FinancialFactor<T = unknown> = {
  value: T;
  confidence: number; // 0~10，支持小数
  source: RawSource | DerivedSource | FallbackSource | ManualSource;
  logicReason?: string; // 用于 Tooltip 展示的引擎逻辑解释
  
  // Extended fields for rich tooltips
  goodDescription?: string;   // 什么是“好”
  badDescription?: string;    // 什么是“坏”
  currentStatus?: string;     // 当前状态描述
  impact?: string;            // 对策略的影响
  score?: number;             // 评分
};

export interface FactorValueById {
  underlying_price: number;
  price: number;
  spx_price: number;
  vix_price: number;
  vix3m_price: number;
  tnx_price: number;
  irx_price: number;
  oil_price: number;
  gold_price: number;
  dxy_price: number;
  underlying_change: number;
  spx_change: number;
  vix_change: number;
  tnx_change: number;
  iv_rank: number;
  iv_percentile: number;
  vol_premium: number;
  iv_hv_ratio: number;
  vix_term_ratio: number;
  real_risk: number;
  macro_score: number;
  risk_score: number;
  opportunity_score: number;
  regime_score: number;
  trend_quality: number;
  price_extension: number;
  rsi: number;
  rsi_7: number;
  rsi_21: number;
  rsi_slope: number;
  macd_momentum_strength: number;
  price_roc_5d: number;
  price_roc_7d: number;
  price_roc_20d: number;
  price_roc_30d: number;
  price_roc_100d: number;
  ma7: number;
  ma30: number;
  ma200: number;
  atr: number;
  atr_ratio: number;
  atr_percent: number;
  atr_shock_weight: number;
  hv20: number;
  hv_20: number;
  hv_30: number;
  historical_volatility: number;
  implied_volatility: number;
  iv_atm: number;
  maxATMIV: number;
  atm_bid_ask_spread: number;
  atmCall: number;
  atmPut: number;
  dte: number;
  strike_round_unit: number;
  pcr: number;
  gamma_flip_level: number | undefined;
  call_wall: number;
  put_wall: number;
  total_gex: number;
  gamma_unstable: boolean;
  iv_curve: IVCurveValue;
  seller_strike_chain: Array<{ expiration: string; daysToExpiration: number; puts: Array<{ strike: number }> }>;
  gex_topology: GEXTopology;
  sigma_event: SigmaEventOutput;
  hmm_regime: HMMResult;
  earnings_date: string | null;
  symbol: string;
  seller_edge_score: number;
  seller_event_score: number;
  seller_premium_score: number;
  seller_edge_tier: 'OBSERVE' | 'WATCH' | 'PRIME' | 'EXTREME';
  seller_sigma_20: number;
  seller_today_log_return: number;
  seller_prior_4d_log_return: number;
  seller_prior_4d_sigma: number;
  seller_downside_z_1d: number;
  seller_downside_z_3d: number;
  seller_downside_z_5d: number;
  seller_intraday_position: number;
  seller_distance_from_37d_high: number;
  seller_distance_from_52w_high: number;
  seller_watch_trigger_streak: number;
  seller_open_trigger_streak: number;
  seller_base_action: 'OPEN' | 'WATCH' | 'WAIT' | 'BLOCK';
  seller_final_action: 'OPEN' | 'WATCH' | 'WAIT' | 'BLOCK';
  seller_history_fingerprint: string;
  seller_history_as_of: string;
  seller_policy_version: string;
}

export type KnownFactorId = keyof FactorValueById;

export type KnownFactorMap = {
  [K in KnownFactorId]?: FinancialFactor<FactorValueById[K]>;
};

export type FactorMap = Record<FactorId, FinancialFactor<any>>;
