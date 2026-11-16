'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Brain, Code } from 'lucide-react';
import dynamic from 'next/dynamic';
const JSONDataModal = dynamic(() => import('./JSONDataModal'), { ssr: false });
import Button from './Button';

export interface DataViewPrompt {
  role: string;
  question: string;
}

interface DataViewButtonProps {
  data: any;
  title?: string;
  label?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  style?: React.CSSProperties;
  prompt?: DataViewPrompt;
}

const DataViewButton: React.FC<DataViewButtonProps> = ({ 
  data,
  title = "查看数据 JSON", 
  label = "DATA",
  size = 'md',
  prompt,
  style: customStyle
}) => {
  const [modalMode, setModalMode] = useState<'ai'|'display'|'close'>('close');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const iconSize = size === 'xs' ? 10 : size === 'sm' ? 12 : 16;
  const defaultMode = (prompt || label === 'ASK AI' || label === 'AI DATA') ? 'ai' : 'display';
  const buttonLabel = prompt ? 'ASK AI' : label;
  const buttonIcon = prompt
    ? <Brain size={iconSize} color="var(--accent-primary)" />
    : <Code size={iconSize} color="var(--accent-info)" />;

  return (
    <>
      <Button 
        onClick={() => setModalMode(defaultMode)}
        title={title}
        size={size}
        icon={buttonIcon}
        style={customStyle}
      >
        {buttonLabel}
      </Button>

      {mounted && modalMode !== 'close' && createPortal(
        <JSONDataModal 
          isOpen={true}
          onClose={() => setModalMode('close')}
          title={title}
          data={data}
          initialMode={defaultMode}
          prompt={prompt}
          />,
        document.body
      )}
    </>
  );
};

export default DataViewButton;
