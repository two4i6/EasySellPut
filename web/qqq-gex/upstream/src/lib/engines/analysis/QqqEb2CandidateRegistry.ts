/**
 * The sole promotion input for QQQ EB2.
 *
 * Research runners and the online coordinator both read this registry.  A
 * candidate can only be promoted after its shared-replay parity test passes;
 * this file deliberately contains rule identifiers and contract inputs, never
 * historical admission dates or a materialized trade ledger.
 */
export type QqqEb2CandidateDefinition = {
  id: string;
  label: string;
  version: string;
  contract: {
    replayVariant: 'bass2_3_3';
    strikeMode: 'delta';
    exitMode: 'hold_to_expiry';
    targetDte: 35;
    entryMode: 'continuous';
    widthMode: 'risk_adaptive_v1';
  };
  admission: {
    e1: 'rolling-screen-rescue5-lite';
    c4: 'dynamic-c4-v1';
    releaseLayers: 'e44-fused-v1';
    e1WarmupFullCalendarYears: number;
    includeRescue5Lite: boolean;
  };
};

export const QQQ_EB2_CANDIDATES = {
  'E44-DYN-PROXY': {
    id: 'E44-DYN-PROXY',
    label: '动态 E44 线上代理（非研发 EB2）',
    version: 'e44-dynamic-proxy-v1',
    contract: {
      replayVariant: 'bass2_3_3',
      strikeMode: 'delta',
      exitMode: 'hold_to_expiry',
      targetDte: 35,
      entryMode: 'continuous',
      widthMode: 'risk_adaptive_v1',
    },
    admission: {
      e1: 'rolling-screen-rescue5-lite',
      c4: 'dynamic-c4-v1',
      releaseLayers: 'e44-fused-v1',
      e1WarmupFullCalendarYears: 0,
      includeRescue5Lite: true,
    },
  },
  'EB2.D0': {
    id: 'EB2.D0',
    label: 'EB2 动态基线（E44-FUSED）',
    version: 'eb2-d0-dynamic-e44-fused-v1',
    contract: {
      replayVariant: 'bass2_3_3',
      strikeMode: 'delta',
      exitMode: 'hold_to_expiry',
      targetDte: 35,
      entryMode: 'continuous',
      widthMode: 'risk_adaptive_v1',
    },
    admission: {
      e1: 'rolling-screen-rescue5-lite',
      c4: 'dynamic-c4-v1',
      releaseLayers: 'e44-fused-v1',
      // Model readiness: five full calendar years after TQQQ first becomes
      // available. This is relative to the input data, not a fixed date.
      e1WarmupFullCalendarYears: 5,
      includeRescue5Lite: true,
    },
  },
} as const satisfies Record<string, QqqEb2CandidateDefinition>;

/**
 * EB2.D0 reproduces all historical EB2 signal dates and evaluates new dates
 * dynamically. It is research-only until its shared parity and tail-risk
 * gates are both recorded.
 */
export const ACTIVE_QQQ_EB2_CANDIDATE_ID = 'EB2.D0' as const;

export const ACTIVE_QQQ_EB2_CANDIDATE = QQQ_EB2_CANDIDATES[ACTIVE_QQQ_EB2_CANDIDATE_ID];

export type QqqEb3CandidateDefinition = {
  id: string;
  label: string;
  version: string;
  parent: 'EB2.D0' | 'EB3.D0' | 'EB3.E1' | 'EB3.E2' | 'EB3.E10' | 'EB3.E12' | 'EB3.E13' | 'EB3.E14' | 'EB3.E18' | 'EB3.E29' | 'EB3.E32' | 'EB3.E34' | 'EB3.E36' | 'EB3.E42' | 'EB3.E47' | 'EB3.E53' | 'EB3.E56';
  releaseChain: 'eb2-e1-e10-e12-current-bar-v1';
  qualityGate: 'none' | 'exclude-unavailable-slow-subregime' | 'exclude-unavailable-slow-subregime-high-rv' | 'exclude-unavailable-slow-subregime-high-rv-high-price';
  replacementRule: 'none' | 'rv20-0.6-0.7-and-trend-bear' | 'rv20-0.6-0.7-and-trend-bear-or-vix-12-16' | 'rv20-0.6-0.7-and-trend-bear-or-stale-bear';
  e12RuleVariant: 'baseline' | 'rule2-tqqqroc05' | 'rule2-tqqqroc05-slow-available' | 'rule2-tqqqroc05-slow-confidence';
  ruleMode?: 'layered' | 'fused';
  e44ExcludedLayers?: readonly string[];
  e44Mode?: 'layered' | 'fused';
  c4ReAdmissionRule?: 'weakening-1-2-and-trendscore-0-25' | 'weakening-under-2-and-trendscore-0-25' | 'adx-low-trend-low-or-er-high-adx-mid' | 'e36-plus-adx-low-trend-low-or-er-high-adx-mid' | 'e42-plus-adx-mid-current-or-navdd-roc-or-roc5-rsi' | 'e47-plus-f10-four-branch-union' | 'e53-plus-shared-volatility-rsi-adx' | 'e56-plus-adx-lowvol-weakening';
};

/** Registered only after the complete E1→E10→E12 lineage passed oracle diff. */
export const QQQ_EB3_CANDIDATES = {
  'EB3.D0': {
    id: 'EB3.D0',
    label: 'EB3 动态基线（EB2.D0 + E1–E10 + E12）',
    version: 'eb3-d0-current-bar-v1',
    parent: 'EB2.D0',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'none',
    replacementRule: 'none',
    e12RuleVariant: 'baseline',
  },
  'EB3.E1': {
    id: 'EB3.E1',
    label: 'EB3 数据质量门控（慢速状态不可用时不新增开仓）',
    version: 'eb3-e1-slow-subregime-health-v1',
    parent: 'EB3.D0',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime',
    replacementRule: 'none',
    e12RuleVariant: 'baseline',
  },
  'EB3.E2': {
    id: 'EB3.E2',
    label: 'EB3 窄风险门控 + RV20/BEAR 替代层',
    version: 'eb3-e2-narrow-risk-replacement-v1',
    parent: 'EB3.E1',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv-high-price',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'baseline',
  },
  'EB3.E3': {
    id: 'EB3.E3',
    label: 'EB3 合并 RV20/趋势/VIX 替代层',
    version: 'eb3-e3-merged-rv-trend-vix-v1',
    parent: 'EB3.E2',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv-high-price',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear-or-vix-12-16',
    e12RuleVariant: 'baseline',
  },
  'EB3.E12': {
    id: 'EB3.E12',
    label: 'EB3 E12.2 ROC 边界放宽候选',
    version: 'eb3-e12-rule2-tqqqroc05-v1',
    parent: 'EB3.E10',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'rule2-tqqqroc05',
  },
  'EB3.E10': {
    id: 'EB3.E10',
    label: 'EB3.E2 简化门控（删除冗余价格条件）',
    version: 'eb3-e10-simplified-stale-high-rv-v1',
    parent: 'EB3.E2',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'baseline',
  },
  'EB3.E13': {
    id: 'EB3.E13',
    label: 'EB3 E12.2 ROC 放宽 + 慢速后验可用性修复',
    version: 'eb3-e13-rule2-tqqqroc05-slow-available-v1',
    parent: 'EB3.E12',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'rule2-tqqqroc05-slow-available',
  },
  'EB3.E14': {
    id: 'EB3.E14',
    label: 'EB3 E12.2 ROC 放宽 + 慢速后验置信度修复',
    version: 'eb3-e14-rule2-tqqqroc05-slow-confidence-v1',
    parent: 'EB3.E13',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'rule2-tqqqroc05-slow-confidence',
  },
  'EB3.E18': {
    id: 'EB3.E18',
    label: 'EB3 E14 全释放链 OR 合并实现',
    version: 'eb3-e18-fused-release-or-v1',
    parent: 'EB3.E14',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'rule2-tqqqroc05-slow-confidence',
    ruleMode: 'fused',
  },
  'EB3.E22': {
    id: 'EB3.E22',
    label: 'EB3 E18 陈旧状态 BEAR 动态替代候选',
    version: 'eb3-e22-stale-bear-replacement-v1',
    parent: 'EB3.E18',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear-or-stale-bear',
    e12RuleVariant: 'rule2-tqqqroc05-slow-confidence',
    ruleMode: 'fused',
  },
  'EB3.E29': {
    id: 'EB3.E29',
    label: 'EB3 E18 E44 四层冗余消减候选',
    version: 'eb3-e29-e44-remove-e3-e5-e31-e34-v1',
    parent: 'EB3.E18',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'rule2-tqqqroc05-slow-confidence',
    ruleMode: 'fused',
    e44ExcludedLayers: ['E3', 'E5', 'E31', 'E34'],
  },
  'EB3.E32': {
    id: 'EB3.E32',
    label: 'EB3 E29 E44 完整 OR 融合候选',
    version: 'eb3-e32-e44-or-fused-v1',
    parent: 'EB3.E29',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'rule2-tqqqroc05-slow-confidence',
    ruleMode: 'fused',
    e44ExcludedLayers: ['E3', 'E5', 'E31', 'E34'],
    e44Mode: 'fused',
  },
  'EB3.E34': {
    id: 'EB3.E34',
    label: 'EB3 E32 C4 弱化信号低趋势动态重接纳候选',
    version: 'eb3-e34-c4-re-admission-weakening-trendscore-v1',
    parent: 'EB3.E32',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'rule2-tqqqroc05-slow-confidence',
    ruleMode: 'fused',
    e44ExcludedLayers: ['E3', 'E5', 'E31', 'E34'],
    e44Mode: 'fused',
    c4ReAdmissionRule: 'weakening-1-2-and-trendscore-0-25',
  },
  'EB3.E36': {
    id: 'EB3.E36',
    label: 'EB3 E34 C4 重接纳规则下界消减候选',
    version: 'eb3-e36-c4-readmission-simplification-v1',
    parent: 'EB3.E34',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'rule2-tqqqroc05-slow-confidence',
    ruleMode: 'fused',
    e44ExcludedLayers: ['E3', 'E5', 'E31', 'E34'],
    e44Mode: 'fused',
    c4ReAdmissionRule: 'weakening-under-2-and-trendscore-0-25',
  },
  'EB3.E42': {
    id: 'EB3.E42',
    label: 'EB3 E36 双分支纯盈利 C4 动态释放候选',
    version: 'eb3-e42-c4-adx-trend-er-union-v1',
    parent: 'EB3.E36',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'rule2-tqqqroc05-slow-confidence',
    ruleMode: 'fused',
    e44ExcludedLayers: ['E3', 'E5', 'E31', 'E34'],
    e44Mode: 'fused',
    c4ReAdmissionRule: 'e36-plus-adx-low-trend-low-or-er-high-adx-mid',
  },
  'EB3.E47': {
    id: 'EB3.E47',
    label: 'EB3 E42 三分支纯盈利 C4 动态释放候选',
    version: 'eb3-e47-c4-three-branch-union-v1',
    parent: 'EB3.E42',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'rule2-tqqqroc05-slow-confidence',
    ruleMode: 'fused',
    e44ExcludedLayers: ['E3', 'E5', 'E31', 'E34'],
    e44Mode: 'fused',
    c4ReAdmissionRule: 'e42-plus-adx-mid-current-or-navdd-roc-or-roc5-rsi',
  },
  'EB3.E53': {
    id: 'EB3.E53',
    label: 'EB3 E47 F10 四分支纯盈利 C4 动态释放候选',
    version: 'eb3-e53-c4-f10-four-branch-union-v1',
    parent: 'EB3.E47',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'rule2-tqqqroc05-slow-confidence',
    ruleMode: 'fused',
    e44ExcludedLayers: ['E3', 'E5', 'E31', 'E34'],
    e44Mode: 'fused',
    c4ReAdmissionRule: 'e47-plus-f10-four-branch-union',
  },
  'EB3.E56': {
    id: 'EB3.E56',
    label: 'EB3 E53 RSI/ADX 共享波动率因子化候选',
    version: 'eb3-e56-c4-shared-volatility-rsi-adx-v1',
    parent: 'EB3.E53',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'rule2-tqqqroc05-slow-confidence',
    ruleMode: 'fused',
    e44ExcludedLayers: ['E3', 'E5', 'E31', 'E34'],
    e44Mode: 'fused',
    c4ReAdmissionRule: 'e53-plus-shared-volatility-rsi-adx',
  },
  'EB3.E76': {
    id: 'EB3.E76',
    label: 'EB3 E56 ADX低波动弱化修复候选',
    version: 'eb3-e76-adx-lowvol-weakening-v1',
    parent: 'EB3.E56',
    releaseChain: 'eb2-e1-e10-e12-current-bar-v1',
    qualityGate: 'exclude-unavailable-slow-subregime-high-rv',
    replacementRule: 'rv20-0.6-0.7-and-trend-bear',
    e12RuleVariant: 'rule2-tqqqroc05-slow-confidence',
    ruleMode: 'fused',
    e44ExcludedLayers: ['E3', 'E5', 'E31', 'E34'],
    e44Mode: 'fused',
    c4ReAdmissionRule: 'e56-plus-adx-lowvol-weakening',
  },
} as const satisfies Record<string, QqqEb3CandidateDefinition>;

export const ACTIVE_QQQ_EB3_CANDIDATE_ID = 'EB3.D0' as const;
export const ACTIVE_QQQ_EB3_CANDIDATE = QQQ_EB3_CANDIDATES[ACTIVE_QQQ_EB3_CANDIDATE_ID];

/** Current EB3 research lineage; production/default candidate remains EB3.D0. */
export const CURRENT_QQQ_EB3_RESEARCH_PARENT_ID = 'EB3.E76' as const;
export const CURRENT_QQQ_EB3_RESEARCH_PARENT = QQQ_EB3_CANDIDATES[CURRENT_QQQ_EB3_RESEARCH_PARENT_ID];

/** EB4 is the research-family alias for the validated EB3.E76 candidate. */
export const QQQ_EB4_RESEARCH_CANDIDATE_ID = 'EB3.E76' as const;
export const QQQ_EB4_RESEARCH_CANDIDATE = QQQ_EB3_CANDIDATES[QQQ_EB4_RESEARCH_CANDIDATE_ID];
export const CURRENT_QQQ_EB4_RESEARCH_PARENT_ID = 'EB3.E76' as const;
export const CURRENT_QQQ_EB4_RESEARCH_PARENT = QQQ_EB4_RESEARCH_CANDIDATE;

export type QqqEb6CandidateDefinition = {
  id: 'EB6';
  label: string;
  version: string;
  parent: 'EB5.E261';
  source: 'EB5.E261';
  contract: {
    replayVariant: 'eb6_e209_dynamic';
    strikeMode: 'delta';
    exitMode: 'hold_to_expiry';
    targetDte: 35;
    entryMode: 'continuous';
    widthMode: 'risk_adaptive_v1';
    ratioMin: 0.36;
    ratioMax: 1.39;
    dteRecoveryVxnThreshold: 22.4;
    dteVxnThreshold: 24;
    dteMinHighRiskDays: 3;
    widthVxnThreshold: 22;
    widthLowVxnTargetPct: 0.065;
    widthHighVxnTargetPct: 0.06;
    activeProfile: 'E209';
    finalVeto: {
      allOf: readonly [
        { key: 'navDrawdownPct'; range: readonly [0.02, 0.06] },
        { key: 'trendScore'; range: readonly [0, 35] },
        { key: 'priceVsSma200Pct'; range: readonly [0.05, 0.08] },
        { key: 'tqqqRealisedVol20d'; range: readonly [0.5, 0.65] },
      ];
    };
  };
  dynamicAdmission: 'current-bar';
  noDateWhitelist: true;
  noFrozenTape: true;
  noWrapperTimeGate: true;
};

/** EB6 research registration; it is intentionally not an active EB2 default. */
export const QQQ_EB6_CANDIDATES = {
  EB6: {
    id: 'EB6',
    label: 'EB6.E209：EB5.E261 blocked-pool 合并的 current-bar 动态实现',
    version: 'eb6-e209-current-bar-dynamic-v1',
    parent: 'EB5.E261',
    source: 'EB5.E261',
    contract: {
      replayVariant: 'eb6_e209_dynamic',
      strikeMode: 'delta',
      exitMode: 'hold_to_expiry',
      targetDte: 35,
      entryMode: 'continuous',
      widthMode: 'risk_adaptive_v1',
      ratioMin: 0.36,
      ratioMax: 1.39,
      dteRecoveryVxnThreshold: 22.4,
      dteVxnThreshold: 24,
      dteMinHighRiskDays: 3,
      widthVxnThreshold: 22,
      widthLowVxnTargetPct: 0.065,
      widthHighVxnTargetPct: 0.06,
      activeProfile: 'E209',
      finalVeto: {
        allOf: [
          { key: 'navDrawdownPct', range: [0.02, 0.06] },
          { key: 'trendScore', range: [0, 35] },
          { key: 'priceVsSma200Pct', range: [0.05, 0.08] },
          { key: 'tqqqRealisedVol20d', range: [0.5, 0.65] },
        ],
      },
    },
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
} as const satisfies Record<string, QqqEb6CandidateDefinition>;

export const QQQ_EB6_CANDIDATE = QQQ_EB6_CANDIDATES.EB6;

/**
 * Canonical starting point for future EB6 research. Child scripts must call
 * this builder first and apply only their single candidate change afterward.
 */
export const CURRENT_QQQ_EB6_RESEARCH_PARENT_ID = 'EB6.E0' as const;
export const CURRENT_QQQ_EB6_RESEARCH_BUILDER = 'buildQqqEb6DynamicReplayWithData' as const;

export type QqqEb7CandidateDefinition = {
  id: 'EB7';
  label: string;
  version: string;
  parent: 'EB6.E235';
  source: 'EB6.E235';
  contract: Omit<QqqEb6CandidateDefinition['contract'], 'replayVariant'> & { replayVariant: 'eb7_e235_dynamic' };
  structuralSimplification: 'score>=1';
  exactParityWith: 'EB6.E234';
  dynamicAdmission: 'current-bar';
  noDateWhitelist: true;
  noFrozenTape: true;
  noWrapperTimeGate: true;
};

/** EB7 is the formal research registration of EB6.E235; it is not a production default. */
export const QQQ_EB7_CANDIDATES = {
  EB7: {
    id: 'EB7',
    label: 'EB7：EB6.E235 score>=1 结构精简等价实现',
    version: 'eb7-e235-score1-current-bar-v1',
    parent: 'EB6.E235',
    source: 'EB6.E235',
    contract: { ...QQQ_EB6_CANDIDATE.contract, replayVariant: 'eb7_e235_dynamic' },
    structuralSimplification: 'score>=1',
    exactParityWith: 'EB6.E234',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
} as const satisfies Record<string, QqqEb7CandidateDefinition>;

export const QQQ_EB7_CANDIDATE = QQQ_EB7_CANDIDATES.EB7;
export const CURRENT_QQQ_EB7_RESEARCH_PARENT_ID = 'EB7.E0' as const;
export const CURRENT_QQQ_EB7_RESEARCH_ROOT_BUILDER = 'buildQqqEb7DynamicReplayWithData' as const;

/**
 * Canonical contract for the EB7.E0 research line.
 * Every EB7 child starts from this current-bar replay and adds one causal
 * change before re-running fixture and risk parity checks.
 */
export const QQQ_EB7_RESEARCH_CONTRACT = {
  root: CURRENT_QQQ_EB7_RESEARCH_PARENT_ID,
  builder: CURRENT_QQQ_EB7_RESEARCH_ROOT_BUILDER,
  admission: 'current-bar',
  singleCandidateChange: true,
  noDateWhitelist: true,
  noFrozenTape: true,
  noWrapperTimeGate: true,
} as const;

export const QQQ_EB7_RESEARCH_CHILDREN = {
  E1: {
    id: 'EB7.E1',
    label: 'EB7.E1：低 RV + SMA200 近线 residual release',
    parent: 'EB7.E0',
    source: 'EB7.E0',
    builder: 'buildQqqEb7E1DynamicReplayWithData',
    version: 'eb7-e1-rv03-sma005-current-bar-v1',
    rule: 'RV20d<0.30 AND priceVsSma200Pct<0.05',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E2: {
    id: 'EB7.E2',
    label: 'EB7.E2：current-bar precision veto + zero-loss residual release',
    parent: 'EB7.E0',
    source: 'EB7.E0',
    builder: 'buildQqqEb7E2DynamicReplayWithData',
    version: 'eb7-e2-precision-veto-release-current-bar-v1',
    rule: 'current-bar veto + current-bar residual release',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E3: {
    id: 'EB7.E3',
    label: 'EB7.E3：E2 后 zero-loss current-bar release',
    parent: 'EB7.E2',
    source: 'EB7.E2',
    builder: 'buildQqqEb7E3DynamicReplayWithData',
    version: 'eb7-e3-zero-loss-release-current-bar-v1',
    rule: 'VIXTermStructureSlope>=4 AND range20dPct<0.05 AND ADX14>=12 AND VIX>=16',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E4: {
    id: 'EB7.E4',
    label: 'EB7.E4：E3 后五条件 zero-loss current-bar release',
    parent: 'EB7.E3',
    source: 'EB7.E3',
    builder: 'buildQqqEb7E4DynamicReplayWithData',
    version: 'eb7-e4-zero-loss-release-current-bar-v1',
    rule: 'TQQQRealisedVol20d<0.30 AND VIX>=16 AND RSI14>=70 AND ROC20<0.10 AND ADX14<35',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E5: {
    id: 'EB7.E5',
    label: 'EB7.E5：E4 后五条件 zero-loss current-bar release',
    parent: 'EB7.E4',
    source: 'EB7.E4',
    builder: 'buildQqqEb7E5DynamicReplayWithData',
    version: 'eb7-e5-zero-loss-release-current-bar-v1',
    rule: 'trend=BEAR AND distanceToSma50Pct>=0 AND vixTermStructureSlope<2 AND TQQQRealisedVol20d<0.80 AND sma20SlopePct<0.02',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E6: {
    id: 'EB7.E6',
    label: 'EB7.E6：E5 后四条件 zero-loss current-bar release',
    parent: 'EB7.E5',
    source: 'EB7.E5',
    builder: 'buildQqqEb7E6DynamicReplayWithData',
    version: 'eb7-e6-zero-loss-release-current-bar-v1',
    rule: 'RSI14>=70 AND trend=BULL AND VIXTermStructureSlope<2 AND ADX14<30',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E7: {
    id: 'EB7.E7',
    label: 'EB7.E7：E6 后四条件 zero-loss current-bar release',
    parent: 'EB7.E6',
    source: 'EB7.E6',
    builder: 'buildQqqEb7E7DynamicReplayWithData',
    version: 'eb7-e7-zero-loss-release-current-bar-v1',
    rule: 'VIXTermStructureSlope>=4 AND priceExtensionAtr<1 AND ADX14>=18 AND priceVsSma200Pct>=0.05',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E8: {
    id: 'EB7.E8',
    label: 'EB7.E8：E7 后四条件 zero-loss current-bar release',
    parent: 'EB7.E7',
    source: 'EB7.E7',
    builder: 'buildQqqEb7E8DynamicReplayWithData',
    version: 'eb7-e8-zero-loss-release-current-bar-v1',
    rule: 'TQQQROC20<-0.10 AND navDrawdownPct<0.05 AND QQQER20>=0.20 AND VIX>=18',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E10: {
    id: 'EB7.E10',
    label: 'EB7.E10：宏观安全状态升仓 + 弱化状态降仓',
    parent: 'EB7.E8',
    source: 'EB7.E8',
    builder: 'buildQqqEb7E10DynamicReplayWithData',
    version: 'eb7-e10-macro-bull-lowvix-weakening-tilt-current-bar-v1',
    rule: 'favorable regime=BULL AND VIX<22; defensive regime=RISK_ON_WEAKENING AND trend=NEUTRAL AND slowSubregime=CURRENT',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E11: {
    id: 'EB7.E11',
    label: 'EB7.E11：宏观弱化中性状态整体升仓 + CURRENT 防守降仓',
    parent: 'EB7.E10',
    source: 'EB7.E10',
    builder: 'buildQqqEb7E11DynamicReplayWithData',
    version: 'eb7-e11-macro-bull-lowvix-weakening-neutral-tilt-current-bar-v1',
    rule: 'favorable (regime=BULL AND VIX<22) OR (regime=RISK_ON_WEAKENING AND trend=NEUTRAL), except CURRENT; defensive regime=RISK_ON_WEAKENING AND trend=NEUTRAL AND slowSubregime=CURRENT',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E12: {
    id: 'EB7.E12',
    label: 'EB7.E12：移除 BULL 分支 VIX 阈值的宏观简化',
    parent: 'EB7.E11',
    source: 'EB7.E11',
    builder: 'buildQqqEb7E12DynamicReplayWithData',
    version: 'eb7-e12-macro-bull-weakening-neutral-tilt-current-bar-v1',
    rule: 'favorable regime=BULL OR (regime=RISK_ON_WEAKENING AND trend=NEUTRAL), except CURRENT; defensive regime=RISK_ON_WEAKENING AND trend=NEUTRAL AND slowSubregime=CURRENT',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E13: {
    id: 'EB7.E13',
    label: 'EB7.E13：E12 宏观升仓系数边界 1.041',
    parent: 'EB7.E12',
    source: 'EB7.E12',
    builder: 'buildQqqEb7E13DynamicReplayWithData',
    version: 'eb7-e13-macro-coefficient-1p041-current-bar-v1',
    rule: 'E12 macro rule unchanged; favorable up multiplier=1.041; defensive down multiplier=0.75',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E14: {
    id: 'EB7.E14',
    label: 'EB7.E14：E13 防守系数边界 0.90',
    parent: 'EB7.E13',
    source: 'EB7.E13',
    builder: 'buildQqqEb7E14DynamicReplayWithData',
    version: 'eb7-e14-macro-defensive-coefficient-0p90-current-bar-v1',
    rule: 'E13 macro rule unchanged; favorable up multiplier=1.041; defensive down multiplier=0.90',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E15: {
    id: 'EB7.E15',
    label: 'EB7.E15：E14 防守系数精细边界 0.93',
    parent: 'EB7.E14',
    source: 'EB7.E14',
    builder: 'buildQqqEb7E15DynamicReplayWithData',
    version: 'eb7-e15-macro-defensive-coefficient-0p93-current-bar-v1',
    rule: 'E14 macro rule unchanged; favorable up multiplier=1.041; defensive down multiplier=0.93',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E16: {
    id: 'EB7.E16',
    label: 'EB7.E16：E15 防守系数超细边界 0.935',
    parent: 'EB7.E15',
    source: 'EB7.E15',
    builder: 'buildQqqEb7E16DynamicReplayWithData',
    version: 'eb7-e16-macro-defensive-coefficient-0p935-current-bar-v1',
    rule: 'E15 macro rule unchanged; favorable up multiplier=1.041; defensive down multiplier=0.935',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E18: {
    id: 'EB7.E18',
    label: 'EB7.E18：E16 RANGE_BOUND/NEUTRAL 宏观族合并',
    parent: 'EB7.E16',
    source: 'EB7.E16',
    builder: 'buildQqqEb7E18DynamicReplayWithData',
    version: 'eb7-e18-macro-bull-weakening-range-neutral-tilt-current-bar-v1',
    rule: 'favorable regime=BULL OR (regime=RISK_ON_WEAKENING AND trend=NEUTRAL) OR (regime=RANGE_BOUND AND trend=NEUTRAL), except defensive CURRENT; up=1.041; down=0.935',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E24: {
    id: 'EB7.E24',
    label: 'EB7.E24：E18 BEAR/SR01 宏观防守重配',
    parent: 'EB7.E18',
    source: 'EB7.E18',
    builder: 'buildQqqEb7E24DynamicReplayWithData',
    version: 'eb7-e24-bear-sr01-macro-risk-rebalance-current-bar-v1',
    rule: 'E18 favorable macro family unchanged; defensive=BEAR AND SR01 OR RISK_ON_WEAKENING AND NEUTRAL AND CURRENT; up=1.44; down=0.60',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E28: {
    id: 'EB7.E28',
    label: 'EB7.E28：E24 BULL/NEUTRAL 宏观状态压缩',
    parent: 'EB7.E24',
    source: 'EB7.E24',
    builder: 'buildQqqEb7E28DynamicReplayWithData',
    version: 'eb7-e28-bull-neutral-macro-compression-current-bar-v1',
    rule: 'favorable=(BULL AND NEUTRAL) OR (RISK_ON_WEAKENING AND NEUTRAL) OR (RANGE_BOUND AND NEUTRAL); defensive=E24 family; up=1.60; down=0.60',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E29: {
    id: 'EB7.E29',
    label: 'EB7.E29：E28 宏观风险预算边界优化',
    parent: 'EB7.E28',
    source: 'EB7.E28',
    builder: 'buildQqqEb7E29DynamicReplayWithData',
    version: 'eb7-e29-e28-macro-budget-boundary-current-bar-v1',
    rule: 'E28 macro state compression unchanged; favorable up=1.66; defensive down=0.50',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E31: {
    id: 'EB7.E31',
    label: 'EB7.E31：E29 宏观风险预算边界精调',
    parent: 'EB7.E29',
    source: 'EB7.E29',
    builder: 'buildQqqEb7E31DynamicReplayWithData',
    version: 'eb7-e31-e29-macro-budget-boundary-current-bar-v1',
    rule: 'E29 macro state compression unchanged; favorable up=1.69; defensive down=0.50',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E38: {
    id: 'EB7.E38',
    label: 'EB7.E38：E31 宏观风险预算分层简化',
    parent: 'EB7.E37',
    source: 'EB7.E31',
    builder: 'buildQqqEb7E38DynamicReplayWithData',
    version: 'eb7-e38-split-range-budget-current-bar-v1',
    rule: 'E31 状态集合不变；主有利状态 up=1.732；RANGE_BOUND+NEUTRAL range=1.50；防守状态 down=0.50',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E40: {
    id: 'EB7.E40',
    label: 'EB7.E40：E38 防守宏观预算重配',
    parent: 'EB7.E38',
    source: 'EB7.E38',
    builder: 'buildQqqEb7E40DynamicReplayWithData',
    version: 'eb7-e40-defensive-macro-budget-current-bar-v1',
    rule: 'E38 状态分桶和有利/区间预算不变；防守桶 downMultiplier=0.625（5/8）',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E54: {
    id: 'EB7.E54',
    label: 'EB7.E54：BULL/SR02 宏观预算轮换（E40 子候选）',
    parent: 'EB7.E40',
    source: 'EB7.E40',
    builder: 'buildQqqEb7E54DynamicReplayWithData',
    version: 'eb7-e54-bull-sr02-budget-rotation-current-bar-v1',
    rule: '保留 E40 分桶；BULL/NEUTRAL/SR02=1.632；BULL/SR02 且 BULL 或 STRONG_BULL=1.20；其余当前 bar 分桶不变',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E55: {
    id: 'EB7.E55',
    label: 'EB7.E55：E54 单参数 BULL/SR02 预算转移',
    parent: 'EB7.E54',
    source: 'EB7.E40',
    builder: 'buildQqqEb7E55DynamicReplayWithData',
    version: 'eb7-e55-single-bull-sr02-budget-transfer-current-bar-v1',
    rule: 'E40 准入和其他预算不变；单一 delta=0.10：BULL/NEUTRAL/SR02=1.632，BULL/SR02 且 BULL/STRONG_BULL trend=1.30；其余状态维持 E40',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E56: {
    id: 'EB7.E56',
    label: 'EB7.E56：E55 单参数预算转移边界筛选',
    parent: 'EB7.E55',
    source: 'EB7.E40',
    builder: 'buildQqqEb7E56DynamicReplayWithData',
    version: 'eb7-e56-single-bull-sr02-transfer-0p108-current-bar-v1',
    rule: 'E55 宏观结构不变；单一 delta=0.108：BULL/NEUTRAL/SR02=1.624，BULL/SR02 bullish trend=1.324；其余预算与准入不变',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E57: {
    id: 'EB7.E57',
    label: 'EB7.E57：E56 单参数风险边界精调',
    parent: 'EB7.E56',
    source: 'EB7.E40',
    builder: 'buildQqqEb7E57DynamicReplayWithData',
    version: 'eb7-e57-single-bull-sr02-transfer-0p109-current-bar-v1',
    rule: 'E56 宏观结构不变；单一 delta=0.109：BULL/NEUTRAL/SR02=1.623，BULL/SR02 bullish trend=1.327；其余预算与准入不变',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E58: {
    id: 'EB7.E58',
    label: 'EB7.E58：E57 单参数预算舍入边界精调',
    parent: 'EB7.E57',
    source: 'EB7.E40',
    builder: 'buildQqqEb7E58DynamicReplayWithData',
    version: 'eb7-e58-single-bull-sr02-transfer-0p1095-current-bar-v1',
    rule: 'E57 宏观结构不变；单一 delta=0.1095：BULL/NEUTRAL/SR02=1.623，BULL/SR02 bullish trend=1.329；其余预算与准入不变',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E60: {
    id: 'EB7.E60',
    label: 'EB7.E60：单参数宏观预算 5:1 转移（E58 子候选）',
    parent: 'EB7.E58',
    source: 'EB7.E40',
    builder: 'buildQqqEb7E60DynamicReplayWithData',
    version: 'eb7-e60-single-bull-sr02-transfer-5to1-0p061-current-bar-v1',
    rule: '保留 E58 的准入与其他预算，仅用 delta=0.061 一维转移：BULL/NEUTRAL/SR02=1.671；BULL/SR02 bullish trend=1.305（固定转移比 5:1）',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E65: {
    id: 'EB7.E65',
    label: 'EB7.E65：单参数宏观预算 7:1 转移（E60 子候选）',
    parent: 'EB7.E60',
    source: 'EB7.E40',
    builder: 'buildQqqEb7E65DynamicReplayWithData',
    version: 'eb7-e65-single-bull-sr02-transfer-7to1-0p0424-current-bar-v1',
    rule: '保留 E60 的准入与其他预算，仅用 delta=0.0424 一维转移：BULL/NEUTRAL/SR02=1.690；BULL/SR02 bullish trend=1.297（固定转移比 7:1）',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E70: {
    id: 'EB7.E70',
    label: 'EB7.E70：E65 中性宏观桶一系数微调',
    parent: 'EB7.E65',
    source: 'EB7.E40',
    builder: 'buildQqqEb7E70DynamicReplayWithData',
    version: 'eb7-e70-e65-neutral-budget-1p691-current-bar-v1',
    rule: 'E65 其余预算和准入不变；只将 BULL/NEUTRAL/SR02 multiplier 从 1.690 调到 1.691，bullish-trend SR02 保持 1.297',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E78: {
    id: 'EB7.E78',
    label: 'EB7.E78：E73–E76 趋势/防守预算边界 formalization',
    parent: 'EB7.E70',
    source: 'EB7.E76',
    builder: 'buildQqqEb7E78DynamicReplayWithData',
    version: 'eb7-e78-e70-trend-defensive-budget-frontier-current-bar-v1',
    rule: 'E70 准入与状态划分不变；bullish-trend/SR02=1.296、defensive=0.63455；其余预算继承 E70。来自 E73–E76 最新 fixture 宏观预算转移边界探索，MDD 贴近上限。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E82: {
    id: 'EB7.E82',
    label: 'EB7.E82：单剂量 mid-VIX → low-VIX 宏观风险转移',
    parent: 'EB7.E78',
    source: 'EB7.E81',
    builder: 'buildQqqEb7E82DynamicReplayWithData',
    version: 'eb7-e82-e78-vix-mid-to-low-transfer-dose-0p04-current-bar-v1',
    rule: 'E78 admission 与其他预算不变；固定比例 0.30:1 的一维 current-bar 风险转移 dose=0.04：VIX-low multiplier=1.04、VIX-mid multiplier=0.988。MTM MDD 贴近上限。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E89: {
    id: 'EB7.E89',
    label: 'EB7.E89：E88 单剂量 VIX 宏观预算边界 formalization',
    parent: 'EB7.E82',
    source: 'EB7.E88',
    builder: 'buildQqqEb7E89DynamicReplayWithData',
    version: 'eb7-e89-e82-vix-mid-to-low-transfer-dose-2p197-current-bar-v1',
    rule: '只改变固定比例 .30 的 VIX mid→low 风险转移剂量至 2.197（low=3.197、mid=.3409）；基于完整 current-bar 引擎，不使用日期/历史 ledger 准入。最新 fixture WR 99.0470%、P&L $914,105.26、MTM MDD $19,999.25；风险尾部显著变差且 MDD 缓冲仅 $0.75，research-only。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E97: {
    id: 'EB7.E97',
    label: 'EB7.E97：主有利 → BULL/neutral/SR02 单标量宏观风险转移',
    parent: 'EB7.E89',
    source: 'EB7.E96',
    builder: 'buildQqqEb7E97DynamicReplayWithData',
    version: 'eb7-e97-e89-main-to-bull-neutral-sr02-transfer-0p40-current-bar-v1',
    rule: 'E89 的 admission、VIX预算及其他宏观桶不变；仅将一个标量 x=0.40 从 main-favorable 转至 BULL/neutral/SR02：up=1.332、bullNeutralSr02=2.091。最新 fixture 交易集合与 E89 一致，WR=99.047%、P&L=$941,589.64、MTM MDD=$19,998.46；研究注册，不改变生产默认。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E106: {
    id: 'EB7.E106',
    label: 'EB7.E106：主有利 → BULL/neutral/SR02/低 VIX 单标量宏观预算转移',
    parent: 'EB7.E97',
    source: 'EB7.E105',
    builder: 'buildQqqEb7E106DynamicReplayWithData',
    version: 'eb7-e106-e97-main-to-bull-neutral-sr02-low-vix-transfer-0p55-current-bar-v1',
    rule: '仅将一个标量 x=.55 从 mainUp 移至当前 bar 的 BULL/NEUTRAL/SR02/VIX<16：mainUp=.782，BULL/NEUTRAL/SR02 共享预算维持 2.091，低 VIX 子桶为 2.641；其他宏观预算与 admission 不变。最新 fixture WR=99.047%、P&L=$954,051.94（较 E97 +$12,462.30）、独立 MTM MDD=$19,999.89；MDD 余量仅 $0.11，最差单笔/CVaR 恶化，research-only。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E112: {
    id: 'EB7.E112',
    label: 'EB7.E112：SR01 → 低 VIX/SR02 单标量宏观风险转移',
    parent: 'EB7.E97',
    source: 'EB7.E109→E110→E111→E112',
    builder: 'buildQqqEb7E112DynamicReplayWithData',
    version: 'eb7-e112-e97-sr01-to-low-vix-sr02-transfer-0p5917-current-bar-v1',
    rule: 'E97 admission 与其他宏观预算不变；单一当前 bar 标量 x=.5917 从 BULL/NEUTRAL/SR01 转至 BULL/NEUTRAL/SR02/VIX<16：donor=.7403、共享 SR02=2.091、低 VIX SR02=2.6827。最新 fixture 1574/1559/15、WR=99.047%、P&L=$978,547.14、独立 MTM MDD=$19,999.99；尾部风险较 E97/E106 更差，余量仅 $0.01，research-only，不作生产晋级。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E120: {
    id: 'EB7.E120',
    label: 'EB7.E120：Extended/SR02 低 VIX → BULL/NEUTRAL/SR02 低 VIX 单剂量转移',
    parent: 'EB7.E112',
    source: 'EB7.E114→E115(rejected)→E116→E117→E118→E119',
    builder: 'buildQqqEb7E120DynamicReplayWithData',
    version: 'eb7-e120-e112-extended-sr02-to-bull-neutral-sr02-transfer-0p5505-current-bar-v1',
    rule: '保持 E112 admission 和其他预算不变；current-bar 单标量 y=.5505 将 RISK_ON_EXTENDED/SR02/VIX<16 预算由 3.197 降至 2.6465，并等量转至 BULL/NEUTRAL/SR02/VIX<16，由 2.6827 升至 3.2332。最新 fixture 1574/1559/15、WR=99.047%、P&L=$1,001,911.36、独立 MTM MDD=$19,999.75；worst/CVaR 恶化且 MDD 余量仅 $0.25，research-only。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E125: {
    id: 'EB7.E125',
    label: 'EB7.E125：固定 1.25 比例宏观预算转移',
    parent: 'EB7.E120',
    source: 'EB7.E122→E123→E124',
    builder: 'buildQqqEb7E125DynamicReplayWithData',
    version: 'eb7-e125-e120-targeted-125x-transfer-0p4193-current-bar-v1',
    rule: '保持 E120 admission 与其余宏观预算不变；current-bar 固定 1.25 接收比例，剂量 x=.4193：RISK_ON_EXTENDED/SR02/VIX<16 由 3.197 降至 2.7777，BULL/NEUTRAL/SR02/VIX<16 由 2.6827 升至 3.206825。最新 fixture 1574/1559/15、WR=99.047%、P&L=$1,006,354.21、独立 MTM MDD=$19,999.76；worst/CVaR 较 E120 略有改善，但 MDD 余量仅 $0.24，research-only。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E130: {
    id: 'EB7.E130',
    label: 'EB7.E130：圆整剂量固定 2:1 宏观预算转移',
    parent: 'EB7.E125',
    source: 'EB7.E127→E128→E129',
    builder: 'buildQqqEb7E130DynamicReplayWithData',
    version: 'eb7-e130-e125-rounded-fixed-2x-transfer-0p24-current-bar-v1',
    rule: '保持 E125 admission 与其他宏观预算不变；current-bar 单一圆整剂量 x=.24，按固定 2:1 将 RISK_ON_EXTENDED/SR02/VIX<16 从 3.197 降至 2.957，并将 BULL/NEUTRAL/SR02/VIX<16 从 2.6827 提至 3.1627。最新 fixture 1574/1559/15、WR=99.047%、P&L=$1,011,654.15、独立 MTM MDD=$19,958.50；较 E125 PL 增加 $5,299.94、MDD 降低 $41.26，交易集合相同；research-only。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E135: {
    id: 'EB7.E135',
    label: 'EB7.E135：E130 与中性桶再平衡合并为单标量宏观分配',
    parent: 'EB7.E130',
    source: 'EB7.E132→E133→E134',
    builder: 'buildQqqEb7E135DynamicReplayWithData',
    version: 'eb7-e135-e130-merged-one-scalar-2x-transfer-0p26-current-bar-v1',
    rule: '保持 E130 admission；一个 current-bar scalar x=.26 联动三个已有宏观桶：Extended/SR02/VIX<16=3.197−x=2.937；BULL/NEUTRAL/SR02/VIX<16=2.6827+1.8x=3.1507；BULL trend/SR02=1.296+.4x=1.4。neutral→bull-trend 分配固定为主剂量的五分之一和 2:1 接收比，不增加独立自由参数。最新 fixture 1574/1559/15、WR=99.047%、P&L=$1,016,708.85、MTM MDD=$19,948.75；较 E130 PL 增加 $5,054.70，MDD 仍低于 $20k，research-only。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E143: {
    id: 'EB7.E143',
    label: 'EB7.E143：main-up → neutral/SR02/低 VIX 固定 4:1 转移',
    parent: 'EB7.E135',
    source: 'EB7.E137→E138(rejected)→E139→E140→E141→E142',
    builder: 'buildQqqEb7E143DynamicReplayWithData',
    version: 'eb7-e143-e135-mainup-to-neutral-lowvix-4x-0p004-current-bar-v1',
    rule: '保持 E135 admission 与三桶 linked allocation 不变；另用一个 current-bar 标量 x=.004，固定 4:1 将 main-up multiplier 由 1.332 降至 1.328，并将 BULL/NEUTRAL/SR02/VIX<16 multiplier 从 3.1507 提至 3.1667。最新 fixture 1574/1559/15、WR=99.047%、P&L=$1,018,077.71、MTM MDD=$19,990.17；较 E135 PL 增加 $1,368.86，MDD 仍低于 $20k 但仅余 $9.83，research-only，风险余量很薄。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E148: {
    id: 'EB7.E148',
    label: 'EB7.E148：单一 main-up 宏观桶系数替代',
    parent: 'EB7.E147',
    source: 'EB7.E145→E146→E147→E148',
    builder: 'buildQqqEb7E148DynamicReplayWithData',
    version: 'eb7-e148-e147-mainup-single-bucket-1p512-current-bar-v1',
    rule: '保留 E135 admission 与所有其他宏观 multiplier；撤销 E147 的接收桶加码，只将 current-bar main-up multiplier 从 1.332 提至 1.512。最新 fixture 1574/1559/15、WR=99.047%、P&L=$1,023,873.06、worst=-$2,515.59、CVaR5=-$41.22、realized MDD=$2,515.59、MTM MDD=$19,999.50；较 E147 P&L 增加 $5,636.14，MDD 余量仅 $0.50，research-only。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E156: {
    id: 'EB7.E156',
    label: 'EB7.E156：E148 单一 19:1 宏观预算转移',
    parent: 'EB7.E148',
    source: 'EB7.E154→E155→E156',
    builder: 'buildQqqEb7E156DynamicReplayWithData',
    version: 'eb7-e156-e148-fixed-19-to-1-macro-transfer-0p036-current-bar-v1',
    rule: '保持 E148 admission 和其余宏观系数不变；current-bar 单标量 x=.036 按固定 19:1 将 BULL/NEUTRAL/SR02 非低 VIX 桶由 2.091 降至 2.055，并将 main-up 由 1.512 提至 2.196。最新 fixture 1574/1559/15、WR=99.047%、P&L=$1,049,439.15、worst=-$2,515.59、CVaR5=-$41.18、realized MDD=$2,515.59、MTM MDD=$19,999.65；相较 E148 P&L +$25,566.09，cycle set 不变；MTM 余量仅 $0.35，research-only、边界敏感。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E172: {
    id: 'EB7.E172',
    label: 'EB7.E172：E156 ratio 区间对称扩展',
    parent: 'EB7.E156',
    source: 'EB7.E172→E173 local frontier',
    builder: 'buildQqqEb7E172DynamicReplayWithData',
    version: 'eb7-e172-e156-symmetric-ratio-band-0p55-current-bar-v1',
    rule: '保持 E156 current-bar admission 和宏观风险预算不变；单一半宽 h=.55，围绕 ratio 中心 .875，将 credit/max-loss ratio 区间固定为 [.325,1.425]。最新 fixture 1576/1561/15，WR 99.0482%，P&L $1,049,932.33，MTM MDD $19,999.65；相对 E156 +$493.18，MDD 余量仅 $0.35；E173 局部细化未超过 E172。research-only、单 snapshot，不代表稳健晋级。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E175: {
    id: 'EB7.E175',
    label: 'EB7.E175：E172 VXN 宽度分支合并为单一固定目标',
    parent: 'EB7.E172',
    source: 'EB7.E174 bottom-up VXN execution ablation',
    builder: 'buildQqqEb7E175DynamicReplayWithData',
    version: 'eb7-e175-e172-fixed-width-target-0p0625-current-bar-v1',
    rule: '保持 E172 admission、宏观预算、DTE 与 ratio band 不变；将 VXN 高/低两段宽度目标合并为 VXN 无关的单一 6.25% 目标。主 fixture 与 E172 逐笔交易集合和全部指标精确一致（1576/1561/15，WR 99.0482%，P&L $1,049,932.33，MTM MDD $19,999.65）；research-only、MDD 余量 $0.35。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E179: {
    id: 'EB7.E179',
    label: 'EB7.E179：移除四条零命中 pre-E235 规则',
    parent: 'EB7.E175',
    source: 'EB7.E178 rule-attribution diagnostic',
    builder: 'buildQqqEb7E179DynamicReplayWithData',
    version: 'eb7-e179-e175-remove-zero-hit-pre-e235-rules-current-bar-v1',
    rule: '基于 E178 最终交易命中归因，删除动态 pre-E235 规则 E70/E84/E96/E97；其他准入及执行逻辑保持 E175 不变。必须与 E175 做完整逐笔回放对照，research-only。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
  E209: {
    id: 'EB7.E209',
    label: 'EB7.E209：E207/E148 22.5% 固定止盈与统一 VIX 参数路径',
    parent: 'EB7.E207',
    source: 'EB7.E207→E148→E209',
    builder: 'buildQqqEb7E209DynamicReplayWithData',
    version: 'eb7-e209-e207-profit-target-0p225-current-bar-v1',
    rule: '保持 current-bar admission、ratio=[.325,1.425] 与固定 6.25% width；统一 VIX multiplier=2.85，profit target=.225，main-up=2.196，bull-neutral SR02=2.055。',
    dynamicAdmission: 'current-bar',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
  },
} as const;

export const CURRENT_QQQ_EB7_RESEARCH_CANDIDATE_ID = 'EB7.E175' as const;
export const CURRENT_QQQ_EB7_RESEARCH_BUILDER = 'buildQqqEb7E175DynamicReplayWithData' as const;
