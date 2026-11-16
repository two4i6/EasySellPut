'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface AISettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  apiMode: 'responses' | 'chat';
  enableThinking: boolean;
  thinkingBudget: number; // For models that support max_tokens based budget
  reasoningEffort: 'low' | 'medium' | 'high'; // For OpenAI o1/o3 models
}

export interface AITemplate {
  id: string;
  label: string;
  description: string;
  baseUrl: string;
  model: string;
  apiMode: AISettings['apiMode'];
  enableThinking?: boolean;
  thinkingBudget?: number;
  reasoningEffort?: AISettings['reasoningEffort'];
}

interface AISettingsState extends AISettings {
  updateSettings: (settings: Partial<AISettings>) => void;
  resetSettings: () => void;
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  apiKey: '',
  baseUrl: '',
  model: 'gpt-4o-mini',
  apiMode: 'responses',
  enableThinking: false,
  thinkingBudget: 2048,
  reasoningEffort: 'medium',
};

export const AI_SETTING_TEMPLATES: AITemplate[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: '官方 OpenAI 兼容接口',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiMode: 'responses',
  },
  {
    id: 'openai-o1',
    label: 'OpenAI o1',
    description: 'OpenAI 强推理模型',
    baseUrl: 'https://api.openai.com/v1',
    model: 'o1',
    apiMode: 'responses',
    enableThinking: true,
    reasoningEffort: 'medium',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek Chat',
    description: 'DeepSeek V3 高速接口',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiMode: 'chat',
  },
  {
    id: 'deepseek-reasoner',
    label: 'DeepSeek R1',
    description: 'DeepSeek 深度思考模型',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-reasoner',
    apiMode: 'chat',
    enableThinking: true,
    thinkingBudget: 4096,
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    description: 'MiniMax Open Platform 接口',
    baseUrl: 'https://api.minimax.chat/v1',
    model: 'MiniMax-Text-01',
    apiMode: 'chat',
  },
];

export const useAISettingsStore = create<AISettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_AI_SETTINGS,
      updateSettings: (settings) => set((state) => ({ ...state, ...settings })),
      resetSettings: () => set(DEFAULT_AI_SETTINGS),
    }),
    {
      name: 'ask-ai-settings',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
