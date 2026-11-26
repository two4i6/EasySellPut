import type { ExposureTile } from './qqqExposureRenderModel';

/** Preserve a usable plot even when independent indicator axes need horizontal space. */
export function heatmapChartSize(width: number, height: number, axisCount: number) {
  return { width: Math.max(width, 58 + 100 + axisCount * 68 + 180), height: Math.max(180, height) };
}

/** Only inspect the supplied, already causal tiles; never invent values in gaps. */
export function moveHeatmapSelection(tiles: readonly ExposureTile[], selected: ExposureTile | null, key: string) {
  if (!tiles.length) return null;
  if (!selected) return tiles.at(-1)!;
  if (key === 'Home' || key === 'End') {
    const time = key === 'Home' ? tiles[0]!.time : tiles.at(-1)!.time;
    return tiles.find(tile => tile.time === time && tile.strike === selected.strike) ?? null;
  }
  const candidates = tiles.filter(tile => key === 'ArrowLeft' ? tile.strike === selected.strike && tile.time < selected.time
    : key === 'ArrowRight' ? tile.strike === selected.strike && tile.time > selected.time
      : key === 'ArrowUp' ? tile.time === selected.time && tile.strike > selected.strike
        : key === 'ArrowDown' ? tile.time === selected.time && tile.strike < selected.strike : false);
  return candidates.reduce<ExposureTile | null>((nearest, tile) => {
    const distance = (candidate: ExposureTile) => key === 'ArrowLeft' || key === 'ArrowRight' ? Math.abs(candidate.time - selected.time) : Math.abs(candidate.strike - selected.strike);
    return !nearest || distance(tile) < distance(nearest) ? tile : nearest;
  }, null) ?? selected;
}
