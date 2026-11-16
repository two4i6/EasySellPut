/** Current-bar PCS width override used only by explicit research replays. */
export type PcsResearchWidthBySlowSubregime = Partial<Record<'SR01' | 'SR02', number>>;
/** Research-only two-state current-bar width rule keyed by spot VIX. */
export type PcsResearchWidthByVix = { maxVix: number; widthPct: number };

export function resolvePcsResearchSpreadWidth(
  baseWidthPct: number,
  slowSubregime: string | undefined,
  overrides?: PcsResearchWidthBySlowSubregime,
  currentVix?: number,
  vixOverride?: PcsResearchWidthByVix,
): number {
  if (vixOverride && Number.isFinite(currentVix) && Number.isFinite(vixOverride.maxVix)
    && Number.isFinite(vixOverride.widthPct) && vixOverride.widthPct > 0
    && (currentVix as number) <= vixOverride.maxVix) {
    return vixOverride.widthPct;
  }
  const override = slowSubregime === 'SR01' || slowSubregime === 'SR02'
    ? overrides?.[slowSubregime]
    : undefined;
  return override !== undefined && Number.isFinite(override) && override > 0
    ? override
    : baseWidthPct;
}
