export const qqqChartDisplayStorageKey = 'qqq-pcs:gex-display:v1';
export const qqqChartLegendKeys = ['kc', 'directional_markers', 'price', 'live', 'vwap', 'rsi', 'score', 'confirmation', 'gex_table', 'gex_positive', 'gex_negative', 'wall_history', 'markers', 'session_shade', 'king', 'call_wall', 'put_wall', 'gamma_flip', 'gamma_position', 'net_gex', 'trade_low', 'trade_high'] as const;
export type QqqChartLegendKey = typeof qqqChartLegendKeys[number];
export function parseQqqChartDisplayPreferences(raw: string | null): Partial<Record<QqqChartLegendKey, boolean>> {
  let result: Partial<Record<QqqChartLegendKey, boolean>> = qqqChartPreset('simple');
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    // Existing v1 combinations used omission to mean visible. Keep that
    // meaning; the new simple default applies only to a fresh/invalid store.
    result = { confirmation:true, trade_low:true, trade_high:true, markers:true, kc:true, rsi:true };
    // Migrate the two old hidden flags into the single pane preference.
    if (typeof value.gamma_position !== 'boolean' && (typeof value.model_zero_gamma === 'boolean' || typeof value.volatility_trigger === 'boolean')) result.gamma_position = value.model_zero_gamma === true && value.volatility_trigger === true;
    for (const key of qqqChartLegendKeys) if (typeof value[key] === 'boolean') result[key] = value[key];
  } catch { /* Invalid or outdated preferences fall back to chart defaults. */ }
  return result;
}

export function qqqChartPreset(name: string): Partial<Record<QqqChartLegendKey, boolean>> {
 const shown = new Set<QqqChartLegendKey>(name === 'simple' ? ['price', 'live', 'vwap', 'directional_markers', 'gex_table', 'king', 'call_wall', 'put_wall', 'gamma_position'] : name === 'structure' ? ['price', 'live', 'directional_markers', 'gex_table', 'king', 'call_wall', 'put_wall', 'net_gex', 'gamma_flip', 'gex_positive', 'gex_negative', 'gamma_position'] : qqqChartLegendKeys);
 return Object.fromEntries(qqqChartLegendKeys.map(key => [key, key === 'score' || key === 'confirmation' || !shown.has(key)]));
}

export type QqqDisplayItem = { key:QqqChartLegendKey; label:string; value:string; color:string; price?:number };
export function groupQqqChartDisplayItems(items:readonly QqqDisplayItem[]) {
 const result:Array<{keys:QqqChartLegendKey[];label:string;value:string;color:string;components:QqqDisplayItem[]}>=[];
 const walls=new Map<number,typeof result[number]>();
 for(const item of items) {
   if(['king','call_wall','put_wall'].includes(item.key)&&Number.isFinite(item.price)) {
     const existing=walls.get(item.price!);
     if(existing){existing.keys.push(item.key);existing.components.push(item);existing.label+=` / ${item.label}`;continue;}
     const entry={keys:[item.key],label:item.label,value:item.value,color:item.color,components:[item]};walls.set(item.price!,entry);result.push(entry);continue;
   }
   const group=item.key==='gex_positive'||item.key==='gex_negative'?'Call / Put 暴露':item.key==='markers'||item.key==='trade_low'||item.key==='trade_high'?'价格反应观察':null;
   const existing=group?result.find(row=>row.label===group):null;
   if(existing){existing.keys.push(item.key);existing.components.push(item);existing.value+=` · ${item.value}`;continue;}
   result.push({keys:[item.key],label:group??item.label,value:item.value,color:item.color,components:[item]});
 }
 return result;
}

export const qqqGexPriceRangeStorageKey = 'qqq-pcs:gex-price-scale:v1';
export const qqqGexTimeRangeStorageKey = 'qqq-pcs:gex-time-scale:v2';
type ChartRange = { from: number; to: number };
export function parseStoredPriceRange(raw: string | null): ChartRange | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return Number.isFinite(value?.from) && Number.isFinite(value?.to) && value.from !== value.to
      ? { from: value.from, to: value.to } : null;
  } catch { return null; }
}
export function parseStoredTimeRange(raw: string | null): ChartRange | null {
  const range = parseStoredPriceRange(raw);
  return range && range.from < range.to ? range : null;
}
export function readQqqChartRange(key: string): ChartRange | null {
  if (typeof window === 'undefined') return null;
  try {
    const parse = key === qqqGexTimeRangeStorageKey ? parseStoredTimeRange : parseStoredPriceRange;
    return parse(window.localStorage.getItem(key));
  } catch { return null; }
}
export function persistQqqChartRange(key: string, range: ChartRange) {
  const parse = key === qqqGexTimeRangeStorageKey ? parseStoredTimeRange : parseStoredPriceRange;
  if (typeof window === 'undefined' || !parse(JSON.stringify(range))) return;
  try { window.localStorage.setItem(key, JSON.stringify(range)); } catch { /* Optional storage. */ }
}
