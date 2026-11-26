import type { QqqPcsApiResponse } from '@/types/qqqGex';

export type QqqDisplayEvidence = {
  asOf: string; view: QqqPcsApiResponse['view'];
  intraday: { gexExpiries?: Array<{ expiryDate: string }>; directional?: NonNullable<QqqPcsApiResponse['intraday']>['directional']; gammaPositionHistory?: NonNullable<QqqPcsApiResponse['intraday']>['gammaPositionHistory'] } | null;
};

/** Default monitoring needs evidence, not a second copy of candles/profiles. */
export function compactQqqDisplayEvidence(data: QqqDisplayEvidence): QqqDisplayEvidence {
  return { asOf: data.asOf, view: data.view, intraday: data.intraday ? {
    gexExpiries: data.intraday.gexExpiries?.map(({ expiryDate }) => ({ expiryDate })),
    directional: data.intraday.directional, gammaPositionHistory: data.intraday.gammaPositionHistory,
  } : null };
}

/** The price overview must not wait for full-day decision evidence. */
export async function loadQqqDisplayEvidence<S, H, G>(overview: boolean, loaders: {
  signals: () => Promise<S>; histories: () => Promise<H>; gamma: () => Promise<G>;
}) {
  if (overview) return null;
  const [signals, histories, gamma] = await Promise.all([loaders.signals(), loaders.histories(), loaders.gamma()]);
  if (signals === null || histories === null) throw Error('GEX 展示证据读取暂不可用');
  return { signals, histories, gamma };
}

/** Attach independently loaded evidence without replacing fresher chart data. */
export function withQqqDisplayEvidence(display: QqqPcsApiResponse | null, evidence: QqqDisplayEvidence | null) {
  if (!display?.intraday || !evidence?.intraday || display.view.date !== evidence.view.date
    || !Number.isFinite(Date.parse(evidence.asOf)) || Date.parse(evidence.asOf) < Date.parse(display.asOf)
    || display.intraday.gexExpiries?.[0]?.expiryDate !== evidence.intraday.gexExpiries?.[0]?.expiryDate) return display;
  return { ...display, intraday: { ...display.intraday,
    directional: evidence.intraday.directional,
    gammaPositionHistory: evidence.intraday.gammaPositionHistory,
  } };
}
