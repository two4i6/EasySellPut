'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Activity, Zap, Shield, Search, Loader2 } from 'lucide-react';
import { Skeleton } from './ui/skeleton';

interface MAGILoadingProps {
  title?: React.ReactNode;
  subtitle?: string;
  icon?: React.ElementType;
  fullScreen?: boolean;
  opacity?: number;
}

export const MAGILoading: React.FC<MAGILoadingProps> = ({ 
  title, 
  subtitle, 
  icon: Icon = Loader2, 
  fullScreen = false,
  opacity = 0.8
}) => {
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      gap: '1.5rem',
      padding: '2rem',
      width: '100%',
      zIndex: 100,
      ...(fullScreen ? {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        background: 'var(--text-tertiary)',
        backdropFilter: 'blur(12px)',
        margin: 0,
      } : {
        flex: 1,
        minHeight: '60vh',
      })
    }}>
      <div style={{ position: 'relative', width: '80px', height: '80px', willChange: 'transform' }}>
        <motion.div 
          initial={{ rotate: 0 }}
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          style={{ 
            position: 'absolute', 
            inset: 0, 
            borderRadius: '50%', 
            border: '2px solid var(--border-color)',
            borderTopColor: 'var(--accent-primary)',
            opacity: 0.5,
            willChange: 'transform',
            transformOrigin: 'center'
          }}
        />
        <motion.div 
          initial={{ rotate: 0 }}
          animate={{ rotate: -360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          style={{ 
            position: 'absolute', 
            inset: '12px', 
            borderRadius: '50%', 
            border: '2px solid var(--border-color)',
            borderBottomColor: 'var(--accent-primary)',
            opacity: 0.3,
            willChange: 'transform',
            transformOrigin: 'center'
          }}
        />
        <div style={{ 
          position: 'absolute', 
          inset: 0, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          willChange: 'opacity'
        }}>
          <Icon size={28} className="skeleton-pulse" style={{ color: 'var(--accent-primary)' }} />
        </div>
      </div>
      
      {(title || subtitle) && (
        <div style={{ textAlign: 'center', maxWidth: '300px' }}>
          {title && (
            <h3 style={{ 
              fontSize: '0.9rem', 
              fontWeight: 800, 
              letterSpacing: '0.15em', 
              marginBottom: '0.5rem', 
              color: 'var(--text-primary)',
              textTransform: 'uppercase'
            }}>
              {title}
            </h3>
          )}
          {subtitle && (
            <p style={{ 
              color: 'var(--text-tertiary)', 
              fontSize: '0.7rem', 
              letterSpacing: '0.05em',
              fontWeight: 600,
              lineHeight: 1.4
            }}>
              {subtitle}
            </p>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse-opacity {
          0% { opacity: 0.4; }
          50% { opacity: 1; }
          100% { opacity: 0.4; }
        }
        .skeleton-pulse {
          animation: pulse-opacity 2s ease-in-out infinite;
          will-change: opacity;
        }
      `}</style>
    </div>
  );
};

export const StockEngineLoading = ({ symbol, fullScreen = false }: { symbol: string, fullScreen?: boolean }) => {
  return (
    <MAGILoading 
      title={<>ANALYZING <span style={{ color: 'var(--accent-primary)' }}>{symbol}</span></>}
      subtitle="SYNCHRONIZING OPTION CHAIN & CALCULATING GREEKS"
      icon={Activity}
      fullScreen={fullScreen}
    />
  );
};

export const MacroLoading = ({ fullScreen = true }: { fullScreen?: boolean }) => {
  return (
    <MAGILoading 
      title="INITIALIZING MAGI"
      subtitle="CONNECTING TO REAL-TIME MARKET DATA FEEDS"
      icon={Zap}
      fullScreen={fullScreen}
    />
  );
};

export const BootingLoading = ({ text, fullScreen = true }: { text: string, fullScreen?: boolean }) => {
  return (
    <MAGILoading 
      title="MAGI SYSTEM"
      subtitle={text.toUpperCase()}
      icon={Shield}
      fullScreen={fullScreen}
    />
  );
};

export const PageLoading = ({ title = "LOADING DATA", subtitle = "Fetching the latest market information" }) => {
  return (
    <MAGILoading 
      title={title}
      subtitle={subtitle}
      icon={Loader2}
    />
  );
};

export const TableLoading = ({ rows = 5, cols = 5 }) => {
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} style={{ height: '40px', width: '100%', animationDelay: `${i * 0.1}s` }} />
      ))}
      <style>{`
        @keyframes loading-pulse {
          0% { opacity: 0.3; }
          50% { opacity: 0.6; }
          100% { opacity: 0.3; }
        }
        .loading-pulse-animation {
          animation: loading-pulse 1.5s infinite ease-in-out;
        }
      `}</style>
    </div>
  );
};
