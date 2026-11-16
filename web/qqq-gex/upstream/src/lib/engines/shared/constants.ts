export const DELTA = {
  CRITICAL:  0.50,  // 强制换仓阈值 (RollEngine forced roll)
  HIGH_RISK: 0.45,  // CSP 高风险预警阈值 (cspWarningEngine high)
  EXECUTION: 0.40,  // CSP 执行平仓/换仓阈值 (cspExecutionEngine)
  WARNING:   0.35,  // 防御性换仓阈值 (RollEngine defensive roll)
  WATCH:     0.30,  // CSP 中等风险监控阈值 (cspWarningEngine medium)
};

export const DTE = {
  CRITICAL: 5,
  WARNING:  7,
  MEDIUM:   10,
};

export const PROFIT = {
  CLOSE_HIGH: 0.70,
  CLOSE_MID:  0.50,
};

export const PRICE_PROXIMITY = {
  NEAR_ITM: 0.02,   // 2%，共 3 处重复
};

export const IV_EXPANSION = {
  HIGH:   1.5,
  MEDIUM: 1.2,
};

export const TECHNICAL = {
  KC_MULTIPLIER:     2.0,   // Keltner Channel ATR 倍数
  DEFAULT_RISK_FREE:  0.045, // 无风险利率
  STRIKE_ROUND_STEP:  1,    // 行权价取整步长（等差，各引擎可自定义）
  TARGET_DTES:       [7, 14, 21, 30, 45, 60, 90],
};
