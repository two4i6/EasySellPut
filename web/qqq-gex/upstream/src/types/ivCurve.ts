export interface OptionContract {
  strike: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  lastPrice?: number | null;
  lastTradeDate?: number | null;
  /** Response receipt time; independent of provider last-trade/quote update time. */
  receivedAt?: string;
  quoteSource?: 'market' | 'last_trade';
  iv: number;            // impliedVolatility
  delta?: number;
  theta?: number;
  gamma?: number;
  vega?: number;
  volume?: number;
  openInterest?: number;
  oiProvenance?: {source: string; asOf: string; receivedAt: string; sha256: string};
  inTheMoney: boolean;
}

export type IVPoint = {
  expiration: string;        // ISO date "2025-05-16"
  daysToExpiration: number;  // 正整数
  atmIV: number;             // 小数形式 e.g. 0.18，非百分比
  atmBidAskSpread: number;   // bid/ask spread 质量指标
  contracts?: {              // 仅当 includeContracts=true 时填充
    calls: OptionContract[];
    puts: OptionContract[];
  };
};

export type IVCurveValue = {
  points: IVPoint[];  // 按 daysToExpiration 升序排列，只含 atmIV > 0 的点
  iv30: number;       // 插值到 30 DTE 的 IV，数据不足时为 0
  /** Yahoo option-chain 根响应的标的价格；存在时 ATM/Greeks 均以它为锚。 */
  snapshotPrice?: number;
  /** Yahoo option-chain 根响应的市场时间（ISO）。 */
  snapshotAsOf?: string;
};

export type IVCurveOptions = {
  minDTE?: number;          // 默认 7，过滤极短到期日（0DTE 噪声）
  maxDTE?: number;          // 默认 180
  maxExpirations?: number;  // 默认 10，最多拉取多少个到期日
  concurrency?: number;     // 默认 4，并行请求数
  includeContracts?: boolean; // 新增：是否包含完整期权链
};
