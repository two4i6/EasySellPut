import type { Worker } from 'node:worker_threads';

/** Every worker termination must settle the caller, including a clean exit without a reply. */
export function qqqWorkerReply<T>(worker: Pick<Worker, 'once' | 'postMessage' | 'terminate'>, job: unknown, timeoutMs = 60_000): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
      void worker.terminate();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('QQQ replay worker timed out without a result'))), timeoutMs);
    worker.once('message', (message: T & { error?: string }) => {
      if (message.error) finish(() => reject(new Error(message.error)));
      else finish(() => resolve(message));
    });
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => finish(() => reject(new Error(`QQQ replay worker exited with code ${code} without a result`))));
    try { worker.postMessage(job); }
    catch (error) { finish(() => reject(error)); }
  });
}
