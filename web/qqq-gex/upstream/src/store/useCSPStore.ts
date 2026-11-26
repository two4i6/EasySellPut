import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CSP_POSTURES } from '@/lib/cspResearch';

export interface CSPSettings {
  // 基础开关
  safetyEnabled: boolean;
  
  // 核心筛选参数
  targetDelta: number;
  minDelta: number;
  maxDelta: number;
  minBid: number;
  maxSpreadPct: number;
  
  // 安全标准/打分参数 (Safety Standard Parameters)
  lossAversion: number;      // LAMBDA: 条件损失厌恶系数 (如 0.15)
  stressProbability: number; // P-Stress: 尾部压力事件先验概率 (如 0.05)
  spreadPenalty: number;     // Alpha-M: 买卖价差流动性惩罚系数 (如 2.0)
  equityPremium: number;     // 股权风险溢价 (如 0.06)
  riskFreeRate: number;      // 无风险利率 (如 0.05)
  svKappa: number;           // 波动率曲面平滑系数 (如 0.4)
  enablePanicIntervention: boolean; // 恐慌干预机制开关

  // Gen 6 Scoring Parameters
  deltaBand: number;         // Delta 宽容带宽 (如 0.10)
  deltaPenaltyAlpha: number; // Delta 偏离惩罚系数 (如 0.15)
  strikeBonusInteger: number; // 整数行权价奖励 (如 1.02)
  strikeBonusFive: number;    // 整 5 行权价奖励 (如 1.05)

  // 技术面引擎敏感度参数 (Technical Analysis Sensitivity)
  techVolumeExhaustionThreshold: number; // 成交量衰减阈值 (默认 0.7)
  techCompressionWidthThreshold: number; // 变盘预警宽度 (默认 0.02)
  techIvSlopeWarningThreshold: number;  // 期权偏斜敏感度 (默认 -0.1)
  techRiskScoreHighThreshold: number;   // 高风险分数阈值 (默认 7)
  techRiskScoreMidThreshold: number;    // 中风险分数阈值 (默认 4)
  techTrendFocus: 'SHORT' | 'LONG' | 'BALANCED'; // 趋势时间范畴重点
  manualAuthorizationOverride: boolean; // 手动授权覆盖
}

export type EnginePosture = 'DEFENSIVE' | 'BALANCED' | 'AGGRESSIVE' | 'CUSTOM';

export { CSP_POSTURES };

interface CSPState extends CSPSettings {
  settingsPanelOpen: boolean;
  currentPosture: EnginePosture;
  updateSettings: (settings: Partial<CSPSettings>) => void;
  setPosture: (posture: EnginePosture) => void;
  toggleSettingsPanel: () => void;
  resetSettings: () => void;
}

export const DEFAULT_CSP_SETTINGS: CSPSettings = {
  safetyEnabled: true,
  enablePanicIntervention: true,
  manualAuthorizationOverride: false,
  targetDelta: -0.20,
  minDelta: -0.40,
  maxDelta: -0.05,
  minBid: 0.01,
  maxSpreadPct: 0.20,

  // 安全标准默认值
  lossAversion: 0.15,
  stressProbability: 0.05,
  spreadPenalty: 2.0,
  equityPremium: 0.06,
  svKappa: 0.4,
  riskFreeRate: 0.05,
  deltaBand: 0.10,
  deltaPenaltyAlpha: 0.15,
  strikeBonusInteger: 1.02,
  strikeBonusFive: 1.05,

  // 技术面敏感度默认值
  techVolumeExhaustionThreshold: 0.7,
  techCompressionWidthThreshold: 0.02,
  techIvSlopeWarningThreshold: -0.1,
  techRiskScoreHighThreshold: 7,
  techRiskScoreMidThreshold: 4,
  techTrendFocus: 'BALANCED',
};

export const useCSPStore = create<CSPState>()(
  persist(
    (set) => ({
      ...DEFAULT_CSP_SETTINGS,
      settingsPanelOpen: false,
      currentPosture: 'BALANCED',
      updateSettings: (settings) => set((state) => ({ 
        ...state, 
        ...settings,
        currentPosture: 'CUSTOM' 
      })),
      setPosture: (posture) => set((state) => {
        if (posture === 'CUSTOM') return { ...state, currentPosture: 'CUSTOM' };
        const presetSettings = CSP_POSTURES[posture];
        return { 
          ...state, 
          ...presetSettings, 
          currentPosture: posture 
        };
      }),
      toggleSettingsPanel: () => set((state) => ({ settingsPanelOpen: !state.settingsPanelOpen })),
      resetSettings: () => set((state) => ({ 
        ...DEFAULT_CSP_SETTINGS, 
        currentPosture: 'BALANCED',
        settingsPanelOpen: state.settingsPanelOpen 
      })),
    }),
    {
      name: 'csp-storage',
      // Exclude settingsPanelOpen from persistence
      partialize: (state) => {
        const { settingsPanelOpen, ...rest } = state;
        return rest;
      },
    }
  )
);
