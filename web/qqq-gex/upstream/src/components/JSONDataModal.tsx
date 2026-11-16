'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { streamText, type ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { Brain, Check, Code, Copy, RefreshCw, Send, Settings2, X } from 'lucide-react';
import {
  AI_SETTING_TEMPLATES,
  DEFAULT_AI_SETTINGS,
  useAISettingsStore,
} from '@/store/useAISettingsStore';
import type { DataViewPrompt } from './DataViewButton';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select } from '@/components/ui/select';

interface JSONDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  data: any;
  initialMode: 'display' | 'ai';
  prompt?: DataViewPrompt;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  modelContent?: string;
  reasoning?: string;
}

const MAX_CONTEXT_LENGTH = 30000;

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const stringifyData = (data: any) => {
  try {
    const json = JSON.stringify(data, null, 2);
    if (!json) return 'null';
    if (json.length <= MAX_CONTEXT_LENGTH) return json;
    return `${json.slice(0, MAX_CONTEXT_LENGTH)}\n... [truncated]`;
  } catch {
    return '[unserializable data]';
  }
};

const MarkdownContent: React.FC<{ content: string }> = ({ content }) => {
  if (!content) return null;

  // Split content by code blocks to handle them separately
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const lines = part.split('\n');
          const lang = lines[0].replace('```', '').trim();
          const code = lines.slice(1, -1).join('\n');
          return (
            <div key={i} style={{ margin: '0.75rem 0' }}>
              {lang && (
                <div style={{ 
                  fontSize: '0.65rem', 
                  color: 'var(--text-tertiary)', 
                  marginBottom: '0.25rem',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  letterSpacing: '0.05em'
                }}>
                  {lang}
                </div>
              )}
              <pre style={{
                margin: 0,
                padding: '1rem',
                backgroundColor: 'rgba(0, 0, 0, 0.35)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                overflowX: 'auto',
                fontSize: '0.8rem',
                lineHeight: 1.5,
                fontFamily: 'var(--font-mono)',
                color: '#e2e8f0'
              }}>
                <code>{code}</code>
              </pre>
            </div>
          );
        }

        // Handle regular text with basic markdown support (headers, lists, bold)
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {part.split('\n').map((line, j) => {
              const trimmedLine = line.trim();
              if (!trimmedLine && line.length > 0) return <div key={j} style={{ height: '0.5rem' }} />;
              if (!trimmedLine) return null;

              // Headers
              if (line.startsWith('### ')) {
                return <h3 key={j} style={{ color: 'var(--accent-primary)', margin: '0.75rem 0 0.25rem', fontSize: '1rem', fontWeight: 800 }}>{line.substring(4)}</h3>;
              }
              if (line.startsWith('## ')) {
                return <h2 key={j} style={{ color: 'var(--accent-primary)', margin: '1rem 0 0.4rem', fontSize: '1.15rem', fontWeight: 800 }}>{line.substring(3)}</h2>;
              }
              if (line.startsWith('# ')) {
                return <h1 key={j} style={{ color: 'var(--accent-primary)', margin: '1.25rem 0 0.5rem', fontSize: '1.3rem', fontWeight: 900 }}>{line.substring(2)}</h1>;
              }

              // Lists
              if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
                const content = line.substring(line.indexOf('- ') + 2 || line.indexOf('* ') + 2);
                return (
                  <div key={j} style={{ display: 'flex', gap: '0.6rem', paddingLeft: '0.5rem', lineHeight: 1.6 }}>
                    <span style={{ color: 'var(--accent-primary)', flexShrink: 0 }}>•</span>
                    <span>{renderInlineFormatting(content)}</span>
                  </div>
                );
              }

              return <div key={j} style={{ lineHeight: 1.65 }}>{renderInlineFormatting(line)}</div>;
            })}
          </div>
        );
      })}
    </div>
  );
};

const renderInlineFormatting = (text: string) => {
  // Handle bold (**text**)
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ color: 'var(--accent-info)', fontWeight: 800 }}>{part.slice(2, -2)}</strong>;
    }
    // Handle inline code (`code`)
    const codeParts = part.split(/(`.*?`)/g);
    return codeParts.map((codePart, j) => {
      if (codePart.startsWith('`') && codePart.endsWith('`')) {
        return (
          <code key={j} style={{ 
            backgroundColor: 'rgba(255, 255, 255, 0.1)', 
            padding: '0.1rem 0.3rem', 
            borderRadius: '4px', 
            fontFamily: 'var(--font-mono)',
            fontSize: '0.85em',
            color: 'var(--accent-info)'
          }}>
            {codePart.slice(1, -1)}
          </code>
        );
      }
      return codePart;
    });
  });
};

const ReasoningBlock: React.FC<{ reasoning: string }> = ({ reasoning }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  if (!reasoning) return null;

  return (
    <div style={{
      margin: '0.5rem 0 1rem 0',
      borderLeft: '2px solid var(--border-color)',
      paddingLeft: '0.75rem'
    }}>
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          color: 'var(--text-tertiary)',
          fontSize: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          cursor: 'pointer'
        }}
      >
        <Brain size={12} style={{ opacity: isExpanded ? 1 : 0.5, color: 'var(--accent-primary)' }} />
        <span style={{ fontWeight: 600 }}>{isExpanded ? 'Hide Reasoning' : 'Thought for a few seconds...'}</span>
      </button>
      {isExpanded && (
        <div style={{
          marginTop: '0.5rem',
          fontSize: '0.8rem',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
          lineHeight: '1.5',
          whiteSpace: 'pre-wrap'
        }}>
          {reasoning}
        </div>
      )}
    </div>
  );
};

const getHistoryKey = (title: string, data: any) => {
  try {
    // Generate a simple hash of the data structure to distinguish contexts
    const dataRef = JSON.stringify(data).slice(0, 100);
    return `option_seller_chat_${title}_${dataRef.length}`;
  } catch {
    return `option_seller_chat_${title}`;
  }
};

const JSONDataModal: React.FC<JSONDataModalProps> = ({
  isOpen,
  onClose,
  title = "数据预览 (JSON DATA)",
  data,
  initialMode,
  prompt,
}) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'data' | 'ai' | 'settings'>(initialMode === 'ai' ? 'ai' : 'data');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasAutoStarted, setHasAutoStarted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const { 
    apiKey, baseUrl, model, apiMode, 
    enableThinking, thinkingBudget, reasoningEffort,
    updateSettings, resetSettings 
  } = useAISettingsStore();
  
  const safeJson = useMemo(() => stringifyData(data), [data]);
  const historyKey = useMemo(() => getHistoryKey(title, data), [title, data]);
  const hasPrompt = Boolean(prompt?.question?.trim());
  const hasConfig = apiKey.trim() !== '' && baseUrl.trim() !== '' && model.trim() !== '' && apiMode.trim() !== '';

  // Load history on open
  useEffect(() => {
    if (isOpen && activeTab === 'ai') {
      const saved = localStorage.getItem(historyKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && messages.length === 0) {
            setMessages(parsed);
          }
        } catch (e) {
          console.error('Failed to load chat history', e);
        }
      }
    }
  }, [isOpen, activeTab, historyKey, messages.length]);

  // Save history on change
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(historyKey, JSON.stringify(messages));
    }
  }, [messages, historyKey]);

  // Context tracking to prevent unnecessary resets
  const lastContextRef = useRef('');
  const wasOpenRef = useRef(false);
  const currentContext = useMemo(() => `${safeJson}|${prompt?.question || ''}`, [safeJson, prompt?.question]);

  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort();
      abortRef.current = null;
      setIsLoading(false);
      wasOpenRef.current = false;
      return;
    }

    // SWR may replace `data` while the modal is open. That must not reset the
    // conversation or restart an AI request; only a new user-open may do so.
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    // Sync tab and compare the context only when the user opens the modal.
    setActiveTab(initialMode === 'ai' ? 'ai' : 'data');
    setCopied(false);

    // Reset conversation ONLY if data or prompt has changed since last time
    if (currentContext !== lastContextRef.current) {
      setMessages([]);
      setInput('');
      setError('');
      setHasAutoStarted(false);
      lastContextRef.current = currentContext;
    }
  }, [isOpen, initialMode, currentContext]);

  useEffect(() => {
    if (activeTab === 'ai') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, activeTab]);

  const handleCopy = () => {
    navigator.clipboard.writeText(safeJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const buildSystemPrompt = () => {
    const customRole = prompt?.role?.trim();
    const basePrompt = customRole || '你是一位专业的金融衍生品分析师。';
    return `${basePrompt} 
  
核心原则：
1. 回答必须极其简短精炼，直击要点，删除所有客套话。
2. 保持中立、客观、理性的专业口吻。
3. 必须始终使用中文回答。
4. 严格基于提供的数据，不得臆测。
5. 如果数据不足以回答问题，请直接说明“数据不足”，而不是编造信息。
6. 第一句话必须总结核心结论，后续内容可提供简要分析或建议。`;
  };

  const wrapWithDataContext = (question: string) => [
    question,
    '',
    '以下是当前面板传入的数据，请严格基于这些数据进行分析：',
    '```json',
    safeJson,
    '```',
  ].join('\n');

  const buildInitialQuestion = () => {
    const question = prompt?.question?.trim() || '请分析这份数据。';
    return wrapWithDataContext(question);
  };

  const toModelMessages = (chatMessages: ChatMessage[]): ModelMessage[] =>
    chatMessages.map((message) => ({
      role: message.role,
      content: message.modelContent ?? message.content,
    }));

  const runChat = async (nextMessages: ChatMessage[]) => {
    if (!hasConfig) {
      setError('请先配置 API 参数。');
      setActiveTab('settings');
      return;
    }

    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    setIsLoading(true);
    setError('');

    const assistantId = createId();
    setMessages([...nextMessages, { id: assistantId, role: 'assistant', content: '', timestamp: Date.now() }]);

    try {
      const provider = createOpenAI({
        apiKey: apiKey.trim(),
        baseURL: baseUrl.trim(),
        name: 'openai-compatible',
      });

      const selectedModel =
        apiMode === 'chat' ? provider.chat(model.trim()) : provider(model.trim());

      const result = streamText({
        model: selectedModel,
        system: buildSystemPrompt(),
        messages: toModelMessages(nextMessages),
        abortSignal: abortController.signal,
        ...(enableThinking ? {
          // If model supports reasoningEffort (OpenAI o1/o3), use it
          ...(model.toLowerCase().includes('o1') || model.toLowerCase().includes('o3') ? {
            reasoningEffort: reasoningEffort
          } : {
            // Otherwise fallback to maxTokens as budget (DeepSeek R1 style)
            maxTokens: thinkingBudget,
          })
        } : {})
      });

      for await (const chunk of result.fullStream) {
        if (chunk.type === 'text-delta') {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: `${message.content}${chunk.text}` }
                : message
            )
          );
        } else if (chunk.type === 'reasoning-delta') {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, reasoning: `${message.reasoning || ''}${chunk.text}` }
                : message
            )
          );
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setMessages((current) => current.filter((message) => message.id !== assistantId));
        return;
      }
      const message = err instanceof Error ? err.message : 'AI 请求失败，请检查配置或服务可达性。';
      setError(message);
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? { ...item, content: '请求失败，请检查 API Key、Base URL、模型名或目标服务的 CORS 设置。' }
            : item
        )
      );
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Only auto-start if in AI tab, have a prompt, haven't started yet, and have config
    if (!isOpen || activeTab !== 'ai' || !hasPrompt || hasAutoStarted || !hasConfig || isLoading) return;

    const initialUserMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: prompt?.question?.trim() || '请分析这份数据。',
      modelContent: buildInitialQuestion(),
      timestamp: Date.now(),
    };

    setHasAutoStarted(true);
    void runChat([initialUserMessage]);
  // The guard makes this a one-shot action for each open prompt; the callback identities are
  // intentionally not triggers because they are recreated from the current form state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAutoStarted, hasConfig, hasPrompt, isLoading, isOpen, activeTab, prompt, safeJson]);

  const handleSubmit = async () => {
    const value = input.trim();
    if (!value || isLoading) return;

    const isFirstMessage = messages.length === 0;
    const nextMessages: ChatMessage[] = [
      ...messages,
      { 
        id: createId(), 
        role: 'user', 
        content: value,
        timestamp: Date.now(),
        modelContent: isFirstMessage ? wrapWithDataContext(value) : undefined
      },
    ];
    setInput('');
    await runChat(nextMessages);
  };

  const handleResetConversation = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    localStorage.removeItem(historyKey);
    setInput('');
    setError('');
    setHasAutoStarted(false);
  };

  const handleApplyTemplate = (template: typeof AI_SETTING_TEMPLATES[0]) => {
    updateSettings({
      baseUrl: template.baseUrl,
      model: template.model,
      apiMode: template.apiMode,
      enableThinking: template.enableThinking ?? false,
      thinkingBudget: template.thinkingBudget ?? 2048,
    });
  };

  if (!isOpen || !data) return null;

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent showClose={false} style={{ maxWidth: '900px', height: '85vh', padding: 0, overflow: 'hidden' }}>
      <div style={{
        backgroundColor: 'rgba(17, 25, 55, 0.95)',
        width: '100%',
        maxWidth: '900px',
        height: '85vh',
        borderRadius: '16px',
        border: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 50px -12px var(--text-tertiary)',
        overflow: 'hidden'
      }}>
        
        {/* Modal Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          background: 'rgba(15, 23, 42, 0.6)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
            {activeTab === 'ai' ? <Brain size={20} color="var(--accent-primary)" /> : 
             activeTab === 'settings' ? <Settings2 size={20} color="var(--accent-info)" /> : 
             <Code size={20} color="#06b6d4" />}
            <div style={{ minWidth: 0 }}>
              <DialogTitle style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</DialogTitle>
              <DialogDescription style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>
                {activeTab === 'ai' ? '基于当前面板数据进行 AI 分析' : 
                 activeTab === 'settings' ? '配置 API Provider 与模型' : 
                 '原始 JSON 数据预览'}
              </DialogDescription>
            </div>
          </div>
          <button 
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.5)',
              cursor: 'pointer',
              padding: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '8px',
              transition: 'background 0.2s'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <Tabs value={activeTab} onValueChange={value => setActiveTab(value as 'data' | 'ai' | 'settings')}>
        <TabsList style={{ display: 'flex', width: '100%', border: 0, borderRadius: 0, background: 'rgba(15, 23, 42, 0.8)' }}>
          {[
            { id: 'data', label: 'Raw Data', icon: <Code size={14} /> },
            { id: 'ai', label: prompt ? 'AI Analysis' : 'AI Chat', icon: <Brain size={14} /> },
            { id: 'settings', label: 'Settings', icon: <Settings2 size={14} /> }
          ].map(tab => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              style={{
                flex: 1,
                padding: '0.9rem',
                background: activeTab === tab.id ? 'var(--bg-subtle)' : 'transparent',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: activeTab === tab.id ? 800 : 600,
                fontSize: '0.8rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                transition: 'all 0.2s',
                letterSpacing: '0.05em'
              }}
            >
              {tab.icon}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Tab Content Area */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-subtle)' }}>
          
          {/* DATA TAB */}
          {activeTab === 'data' && (
            <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{
                position: 'absolute',
                top: '1rem',
                right: '1.5rem',
                zIndex: 10
              }}>
                <button 
                  onClick={handleCopy}
                  style={{
                    background: copied ? '#22c55e' : 'var(--bg-hover)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '0.5rem 1rem',
                    color: 'var(--text-primary)',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    transition: 'all 0.2s',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied!' : 'Copy JSON'}
                </button>
              </div>
              <ScrollArea style={{ padding: '1.5rem', flex: 1 }}>
                <pre style={{
                  margin: 0,
                  fontSize: '0.85rem',
                  lineHeight: '1.6',
                  color: '#94a3b8',
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
                  {safeJson}
                </pre>
              </ScrollArea>
            </div>
          )}

          {/* AI TAB */}
          {activeTab === 'ai' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              
              {/* AI Context/Toolbar */}
              <div style={{
                padding: '0.75rem 1.5rem',
                borderBottom: '1px solid var(--border-color)',
                background: 'rgba(15, 23, 42, 0.4)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem'
              }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {hasPrompt ? `Prompt: ${prompt?.question}` : '围绕当前 JSON 数据自由提问...'}
                </div>
                {hasConfig && messages.length > 0 && (
                  <button
                    onClick={handleResetConversation}
                    style={{
                      background: 'var(--bg-hover)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      padding: '0.35rem 0.75rem',
                      color: 'var(--text-secondary)',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      flexShrink: 0
                    }}
                  >
                    <RefreshCw size={12} />
                    重置对话
                  </button>
                )}
              </div>

              {/* Chat Messages */}
              <div style={{
                flex: 1,
                overflow: 'auto',
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.5rem'
              }}>
                {!hasConfig ? (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    gap: '1.5rem',
                    color: 'var(--text-secondary)'
                  }}>
                    <Settings2 size={64} style={{ opacity: 0.2 }} />
                    <div style={{ textAlign: 'center' }}>
                      <h4 style={{ color: 'var(--text-primary)', margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>配置缺失</h4>
                      <p style={{ fontSize: '0.85rem', margin: 0, maxWidth: '300px', lineHeight: 1.5 }}>
                        需要配置 API Key 和 Base URL 才能使用 AI 分析功能。所有请求仅在你本地的浏览器发起。
                      </p>
                    </div>
                    <button
                      onClick={() => setActiveTab('settings')}
                      style={{
                        background: 'var(--accent-primary)',
                        color: '#08111f',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '0.75rem 2rem',
                        fontWeight: 800,
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        boxShadow: '0 4px 12px rgba(34, 197, 94, 0.2)'
                      }}
                    >
                      前往配置
                    </button>
                  </div>
                ) : messages.length === 0 && !isLoading ? (
                  <div style={{
                    border: '1px dashed var(--border-color)',
                    borderRadius: '16px',
                    padding: '2rem',
                    textAlign: 'center',
                    color: 'var(--text-tertiary)',
                    fontSize: '0.85rem',
                    lineHeight: 1.6,
                    margin: 'auto 0'
                  }}>
                    {hasPrompt
                      ? '配置完成！点击下方按钮发送预设请求...'
                      : '你可以直接在下方输入框提问，AI 将基于当前面板的数据进行回答。'}
                  </div>
                ) : (
                  <>
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        style={{
                          alignSelf: message.role === 'user' ? 'flex-end' : 'stretch',
                          maxWidth: message.role === 'user' ? '85%' : '100%',
                          background: message.role === 'user' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(15, 23, 42, 0.72)',
                          border: `1px solid ${message.role === 'user' ? 'rgba(34, 197, 94, 0.25)' : 'var(--border-color)'}`,
                          borderRadius: message.role === 'user' ? '16px 16px 6px 16px' : '16px 16px 16px 6px',
                          padding: '1.25rem'
                        }}
                      >
                        <div style={{
                          fontSize: '0.65rem',
                          fontWeight: 900,
                          letterSpacing: '0.15em',
                          textTransform: 'uppercase',
                          color: message.role === 'user' ? 'var(--accent-primary)' : 'var(--accent-info)',
                          marginBottom: '0.75rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          justifyContent: 'space-between'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {message.role === 'user' ? 'You' : 'AI Assistant'}
                          </div>
                          {message.timestamp && (
                            <div style={{ 
                              color: 'var(--text-tertiary)', 
                              fontWeight: 400, 
                              fontSize: '0.6rem',
                              letterSpacing: 'normal',
                              textTransform: 'none'
                            }}>
                              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>
                        <div style={{
                          fontSize: '0.9rem',
                          color: 'var(--text-primary)'
                        }}>
                          {message.role === 'assistant' && message.reasoning && (
                            <ReasoningBlock reasoning={message.reasoning} />
                          )}
                          <MarkdownContent content={message.content || (isLoading && message.role === 'assistant' ? '...' : '')} />
                        </div>
                      </div>
                    ))}

                    {error && (
                      <div style={{
                        border: '1px solid rgba(239, 68, 68, 0.25)',
                        background: 'rgba(239, 68, 68, 0.08)',
                        borderRadius: '12px',
                        padding: '1rem',
                        color: 'var(--accent-danger)',
                        fontSize: '0.85rem',
                        lineHeight: 1.5
                      }}>
                        <strong>Error:</strong> {error}
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* Chat Input */}
              {hasConfig && (
                <div style={{
                  borderTop: '1px solid var(--border-color)',
                  padding: '1.25rem 1.5rem',
                  background: 'rgba(15, 23, 42, 0.8)'
                }}>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
                    <textarea
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void handleSubmit();
                        }
                      }}
                      placeholder="Type your question..."
                      rows={1}
                      style={{
                        flex: 1,
                        resize: 'none',
                        borderRadius: '10px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-subtle)',
                        color: 'var(--text-primary)',
                        padding: '0.6rem 0.9rem',
                        outline: 'none',
                        fontFamily: 'inherit',
                        fontSize: '0.85rem',
                        lineHeight: '1.4',
                        minHeight: '40px',
                        maxHeight: '120px'
                      }}
                    />
                    <button
                      onClick={() => {
                        if (messages.length === 0 && hasPrompt && !input && prompt) {
                          setInput(prompt.question);
                          setTimeout(() => handleSubmit(), 0);
                        } else {
                          void handleSubmit();
                        }
                      }}
                      disabled={isLoading || (input.trim() === '' && !(messages.length === 0 && hasPrompt))}
                      style={{
                        border: 'none',
                        borderRadius: '10px',
                        padding: '0 1.25rem',
                        height: '40px',
                        cursor: isLoading ? 'not-allowed' : 'pointer',
                        background: isLoading ? 'var(--border-color)' : 'var(--accent-primary)',
                        color: isLoading ? 'var(--text-secondary)' : '#08111f',
                        fontWeight: 800,
                        fontSize: '0.8rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        transition: 'all 0.2s',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      <Send size={14} />
                      {isLoading ? '...' : (messages.length === 0 && hasPrompt && !input) ? 'Send Prompt' : 'Send'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SETTINGS TAB */}
          {activeTab === 'settings' && (
            <ScrollArea style={{ padding: '2rem', height: '100%', display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Quick Templates
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                  {AI_SETTING_TEMPLATES.map((template) => {
                    const isActive = baseUrl.trim() === template.baseUrl && model.trim() === template.model && apiMode === template.apiMode;
                    return (
                      <button
                        key={template.id}
                        onClick={() => handleApplyTemplate(template)}
                        style={{
                          border: `1px solid ${isActive ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                          background: isActive ? 'rgba(34, 197, 94, 0.08)' : 'var(--bg-secondary)',
                          color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)',
                          borderRadius: '12px',
                          padding: '1.25rem',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          gap: '0.5rem',
                          textAlign: 'left'
                        }}
                      >
                        <span style={{ fontSize: '1rem', fontWeight: 800 }}>{template.label}</span>
                        <span style={{ fontSize: '0.8rem', color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)', lineHeight: 1.4 }}>{template.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', background: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    API Configuration
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-subtle)', padding: '4px 12px', borderRadius: '20px', border: '1px solid var(--border-color)' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: enableThinking ? 'var(--accent-primary)' : 'var(--text-tertiary)' }}>
                      思考模式 (THINKING)
                    </span>
                    <button
                      onClick={() => updateSettings({ enableThinking: !enableThinking })}
                      style={{
                        width: '32px',
                        height: '18px',
                        borderRadius: '9px',
                        background: enableThinking ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                        border: 'none',
                        position: 'relative',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      <div style={{
                        width: '14px',
                        height: '14px',
                        borderRadius: '50%',
                        background: '#fff',
                        position: 'absolute',
                        top: '2px',
                        left: enableThinking ? '16px' : '2px',
                        transition: 'all 0.2s'
                      }} />
                    </button>
                  </div>
                </div>
                
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '1.5rem'
                }}>
                  {[
                    { label: 'API Key', value: apiKey, type: 'password', key: 'apiKey' as const, placeholder: 'sk-...' },
                    { label: 'Base URL', value: baseUrl, type: 'text', key: 'baseUrl' as const, placeholder: 'https://api.openai.com/v1' },
                    { label: 'Model', value: model, type: 'text', key: 'model' as const, placeholder: DEFAULT_AI_SETTINGS.model },
                  ].map((field) => (
                    <label key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                        {field.label}
                      </span>
                      <input
                        type={field.type}
                        value={field.value}
                        onChange={(event) => updateSettings({ [field.key]: event.target.value })}
                        placeholder={field.placeholder}
                        style={{
                          borderRadius: '10px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-subtle)',
                          color: 'var(--text-primary)',
                          padding: '0.85rem 1rem',
                          outline: 'none',
                          fontSize: '0.9rem'
                        }}
                      />
                    </label>
                  ))}
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                        API Mode
                      </span>
                      <Select
                        value={apiMode}
                        onChange={(event) => updateSettings({ apiMode: event.target.value as 'responses' | 'chat' })}
                        style={{
                          borderRadius: '10px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-subtle)',
                          color: 'var(--text-primary)',
                          padding: '0.85rem 1rem',
                          outline: 'none',
                          fontSize: '0.9rem',
                          appearance: 'none',
                          cursor: 'pointer',
                          width: '100%'
                        }}
                      >
                        <option value="responses">responses (Default)</option>
                        <option value="chat">chat (Ollama/Custom)</option>
                      </Select>
                    </label>

                    {model.toLowerCase().includes('o1') || model.toLowerCase().includes('o3') ? (
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', opacity: enableThinking ? 1 : 0.4 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                          思考强度 (EFFORT)
                        </span>
                        <Select
                          disabled={!enableThinking}
                          value={reasoningEffort}
                          onChange={(event) => updateSettings({ reasoningEffort: event.target.value as 'low' | 'medium' | 'high' })}
                          style={{
                            borderRadius: '10px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-subtle)',
                            color: 'var(--text-primary)',
                            padding: '0.85rem 1rem',
                            outline: 'none',
                            fontSize: '0.9rem',
                            appearance: 'none',
                            cursor: 'pointer',
                            width: '100%'
                          }}
                        >
                          <option value="low">Low (快速推理)</option>
                          <option value="medium">Medium (标准推理)</option>
                          <option value="high">High (深度推理)</option>
                        </Select>
                      </label>
                    ) : (
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', opacity: enableThinking ? 1 : 0.4 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                          思考强度 (BUDGET)
                        </span>
                        <input
                          type="number"
                          disabled={!enableThinking}
                          value={thinkingBudget}
                          onChange={(event) => updateSettings({ thinkingBudget: parseInt(event.target.value) || 0 })}
                          style={{
                            borderRadius: '10px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-subtle)',
                            color: 'var(--text-primary)',
                            padding: '0.85rem 1rem',
                            outline: 'none',
                            fontSize: '0.9rem',
                            width: '100%'
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1.5rem' }}>
                  <button
                    onClick={resetSettings}
                    style={{
                      border: '1px solid var(--border-color)',
                      background: 'transparent',
                      color: 'var(--accent-danger)',
                      borderRadius: '8px',
                      padding: '0.6rem 1.25rem',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 700
                    }}
                  >
                    Clear Settings
                  </button>
                </div>
              </div>
            </ScrollArea>
          )}

        </div>
        </Tabs>
      </div>
      </DialogContent>
    </Dialog>
  );
};

export default JSONDataModal;
