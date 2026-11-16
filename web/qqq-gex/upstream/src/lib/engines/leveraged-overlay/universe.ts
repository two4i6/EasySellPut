/** Public Overlay universes. Keep symbol selection here; callers must not invent symbols. */
export type OverlayUniverseId =
  | 'nasdaq-tqqq'
  | 'nasdaq-qld'
  | 'nasdaq-qqq'
  | 'sp500-upro'
  | 'sp500-sso'
  | 'sp500-spy';
export type OverlaySignalSymbol = 'QQQ' | 'SPY';
export function isOverlaySignalSymbol(value: unknown): value is OverlaySignalSymbol {
  return value === 'QQQ' || value === 'SPY';
}

export type OverlayUniverse = {
  id: OverlayUniverseId;
  label: string;
  market: 'NASDAQ' | 'S&P 500';
  leveragedSymbol: 'TQQQ' | 'QLD' | 'QQQ' | 'UPRO' | 'SSO' | 'SPY';
  signalSymbol: OverlaySignalSymbol;
  optionSymbol: 'QQQ' | 'SPY';
  collarOptionSymbol: 'TQQQ' | 'QLD' | 'QQQ' | 'UPRO' | 'SSO' | 'SPY';
  primaryVolatility: 'VXN' | 'VIX';
  leverage: 1 | 2 | 3;
};

export const OVERLAY_UNIVERSES: Readonly<Record<OverlayUniverseId, OverlayUniverse>> = {
  'nasdaq-tqqq': { id: 'nasdaq-tqqq', label: 'NASDAQ · TQQQ', market: 'NASDAQ', leveragedSymbol: 'TQQQ', signalSymbol: 'QQQ', optionSymbol: 'QQQ', collarOptionSymbol: 'TQQQ', primaryVolatility: 'VXN', leverage: 3 },
  'nasdaq-qld': { id: 'nasdaq-qld', label: 'NASDAQ · QLD', market: 'NASDAQ', leveragedSymbol: 'QLD', signalSymbol: 'QQQ', optionSymbol: 'QQQ', collarOptionSymbol: 'QLD', primaryVolatility: 'VXN', leverage: 2 },
  'nasdaq-qqq': { id: 'nasdaq-qqq', label: 'NASDAQ · QQQ', market: 'NASDAQ', leveragedSymbol: 'QQQ', signalSymbol: 'QQQ', optionSymbol: 'QQQ', collarOptionSymbol: 'QQQ', primaryVolatility: 'VXN', leverage: 1 },
  'sp500-upro': { id: 'sp500-upro', label: 'S&P 500 · UPRO', market: 'S&P 500', leveragedSymbol: 'UPRO', signalSymbol: 'SPY', optionSymbol: 'SPY', collarOptionSymbol: 'UPRO', primaryVolatility: 'VIX', leverage: 3 },
  'sp500-sso': { id: 'sp500-sso', label: 'S&P 500 · SSO', market: 'S&P 500', leveragedSymbol: 'SSO', signalSymbol: 'SPY', optionSymbol: 'SPY', collarOptionSymbol: 'SSO', primaryVolatility: 'VIX', leverage: 2 },
  'sp500-spy': { id: 'sp500-spy', label: 'S&P 500 · SPY', market: 'S&P 500', leveragedSymbol: 'SPY', signalSymbol: 'SPY', optionSymbol: 'SPY', collarOptionSymbol: 'SPY', primaryVolatility: 'VIX', leverage: 1 },
};

export function getOverlayUniverse(id: string | undefined): OverlayUniverse {
  return OVERLAY_UNIVERSES[id as OverlayUniverseId] ?? OVERLAY_UNIVERSES['nasdaq-tqqq'];
}

/** One-time migration for persisted pre-universe state. Unknown/SOXL is intentionally reset. */
export function universeIdFromLegacySymbol(symbol: string | undefined): OverlayUniverseId {
  switch (symbol?.toUpperCase()) {
    case 'QLD': return 'nasdaq-qld';
    case 'QQQ': return 'nasdaq-qqq';
    case 'UPRO': return 'sp500-upro';
    case 'SSO': return 'sp500-sso';
    case 'SPY': return 'sp500-spy';
    case 'TQQQ': return 'nasdaq-tqqq';
    default: return 'nasdaq-tqqq';
  }
}
