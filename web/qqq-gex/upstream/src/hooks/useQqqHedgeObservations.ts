'use client';
import { useEffect, useState } from 'react';
import { prepareHedgeObservations, type HedgeObservation, type HedgeObservationInput } from '@/lib/qqqHedgeObservations';

const cache = new WeakMap<HedgeObservationInput['frames'], WeakMap<HedgeObservationInput['bars'], HedgeObservation[]>>();
export function useQqqHedgeObservations(input: HedgeObservationInput, enabled: boolean) {
  const [prepared, setPrepared] = useState<{ input: HedgeObservationInput; series: HedgeObservation[] } | null>(null);
  const [failure, setFailure] = useState<HedgeObservationInput | null>(null);
  const cached = cache.get(input.frames)?.get(input.bars);
  const ready = prepared?.input === input;
  useEffect(() => {
    if (!enabled || ready || cached) return;
    const controller = new AbortController();
    void prepareHedgeObservations(input, controller.signal).then(series => {
      if (controller.signal.aborted) return;
      let byBars = cache.get(input.frames);
      if (!byBars) { byBars = new WeakMap(); cache.set(input.frames, byBars); }
      byBars.set(input.bars, series); setPrepared({ input, series }); setFailure(null);
    }).catch(() => { if (!controller.signal.aborted) setFailure(input); });
    return () => controller.abort();
  }, [input, enabled, ready, cached]);
  return { series: cached ?? (ready ? prepared.series : null), error: failure === input };
}
