/**
 * 交易内核事件定义 (Atomic Trading Events)
 * 
 * 语义封闭原则：
 * 1. 事件原子化：一个事件代表一个物理观测，禁止组合。
 * 2. 反应唯一化：一个事件对应一个确定的反应，禁止优化。
 * 3. 语义剥离：禁止 reason，禁止 score，禁止 intensity。
 */

export type AtomicTrigger = 
  | 'IV_SPIKE'       // IV 突发跳升
  | 'PRICE_DROP'     // 价格短期超跌
  | 'VOL_SURGE'      // 成交量异常放大
  | 'MEAN_REVERSION' // 价格偏离均线
  | 'DEFAULT_SCAN';  // 常规扫描（无异常）

export interface DiscoveryEvent {
  readonly eventId: string;        // 物理唯一标识 (e.g., "evt_nvda_iv_1713512400")
  readonly symbol: string;
  readonly trigger: AtomicTrigger; // 唯一触发原因
  readonly observation: {
    readonly value: number;        // 原始物理值
    readonly unit: string;         // 单位 (σ, %, USD)
  };
  readonly timestamp: number;
}

/**
 * 反应指令 (Reactive Instruction)
 * 
 * 由事件直接触发的确定性动作指令。
 */
export interface ReactiveInstruction {
  readonly sourceEventId: string;
  readonly action: 'OPEN_CSP' | 'OPEN_CC' | 'ALARM_ONLY';
  readonly params: {
    readonly deltaTarget: number;  // 固定的物理参数映射
    readonly dtePreference: 'NEAR' | 'MID' | 'FAR';
  };
}

/**
 * 渲染负载 (Render Payload)
 * 
 * 传递给 UI 的最终扁平化数据，UI 不再进行任何逻辑计算。
 */
export interface StrategyRenderPayload {
  readonly event: DiscoveryEvent;
  readonly instruction: ReactiveInstruction;
  readonly result: {
    readonly strike: number;
    readonly premium: number;
    readonly apr: number;
    readonly breakEven: number;
    readonly safetyMargin: string; // e.g., "15.2%"
  };
  readonly status: 'READY' | 'DEGRADED' | 'FAILED';
}
