import { parseExposureWire } from './qqqExposureWire';
import type { ExposureHistoryDay } from './qqqExposureHistoryModel';
let active = 0;

/** Bound background decoding to two chunks. Each short-lived worker releases
 * its complete wire/object copy on completion or cancellation. */
export function parseExposureWireClient(body: string, signal?: AbortSignal): Promise<ExposureHistoryDay> {
  signal?.throwIfAborted();
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || active >= 2) return parseExposureWire(body, signal);
  let worker: Worker;
  try { worker = new Worker(new URL('./qqqExposureWire.worker.ts', import.meta.url)); }
  catch { return parseExposureWire(body, signal); }
  active++;
  return new Promise<ExposureHistoryDay>((resolve, reject) => {
    let complete = false;
    const cleanup = () => { complete = true; active--; signal?.removeEventListener('abort', cancel); worker.terminate(); };
    const cancel = () => { if (!complete) { cleanup(); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); } };
    worker.onmessage = ({ data }: MessageEvent<{ day?: ExposureHistoryDay; error?: string }>) => {
      if (complete) return;
      cleanup();
      data.day ? resolve(data.day) : reject(Error(data.error ?? 'Invalid exposure archive'));
    };
    worker.onerror = () => {
      if (complete) return;
      cleanup();
      // CSP/worker startup failures retain the cooperative parser fallback.
      void parseExposureWire(body, signal).then(resolve, reject);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    try { worker.postMessage({ body }); }
    catch { cleanup(); void parseExposureWire(body, signal).then(resolve, reject); }
  });
}
