/// <reference lib="webworker" />
import { parseExposureWire } from './qqqExposureWire';
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async ({ data }: MessageEvent<{ body: string }>) => {
  try { scope.postMessage({ day: await parseExposureWire(data.body) }); }
  catch { scope.postMessage({ error: 'Invalid exposure archive' }); }
};
