/**
 * Run the independent EB7 and P6 arms on separate CPU workers.
 *
 * This is an execution optimization only: both workers receive the same
 * complete MarketDataSet and run the unchanged chronological builders. The
 * coordinator remains in the parent thread, so the accepted open-date set is
 * identical to the serial composition.
 */
import { Worker } from 'node:worker_threads';
import { qqqWorkerReply } from './qqqWorkerReply';
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import type { QqqP4DynamicReplay } from './QqqP4DynamicReplay';
import type { QqqEb2Cycle } from './QqqEb2E44Fused';
import type { QqqEb7P6R9WorkerJob, QqqEb7P6R9WorkerResult } from './QqqEb7P6R9Worker';

type WorkerArmResult = {
  eb7: { dailySignals: QqqP4DynamicReplay['dailySignals']; cycles: readonly QqqEb2Cycle[]; dataFingerprint: string };
  p6: Pick<QqqP4DynamicReplay, 'tradeLog' | 'dataFingerprint' | 'dailySignals'>;
};

function runWorker(job: QqqEb7P6R9WorkerJob): Promise<QqqEb7P6R9WorkerResult> {
  return qqqWorkerReply(new Worker(new URL('./QqqEb7P6R9Worker.ts', import.meta.url)), job);
}

export async function runQqqEb7P6R9ArmsInWorkers(startDate: string, endDate: string, data: MarketDataSet, equityBoostMode: QqqEb7P6R9WorkerJob['equityBoostMode'] = 'EB7.E175', pcsMode: QqqEb7P6R9WorkerJob['pcsMode'] = 'E385'): Promise<WorkerArmResult> {
  const [eb7, p6] = await Promise.all([
    runWorker({ kind: equityBoostMode === 'EB6.E209' ? 'EB6' : 'EB7', startDate, endDate, data, equityBoostMode }),
    runWorker({ kind: 'P6', startDate, endDate, data, pcsMode }),
  ]);
  if ((eb7.kind !== 'EB7' && eb7.kind !== 'EB6') || !eb7.cycles) throw new Error('equity boost replay worker returned an invalid result');
  if (p6.kind !== 'P6' || !p6.tradeLog) throw new Error('P6 replay worker returned an invalid result');
  return {
    eb7: { dailySignals: eb7.dailySignals ?? [], cycles: eb7.cycles, dataFingerprint: eb7.dataFingerprint },
    p6: { tradeLog: p6.tradeLog, dailySignals: p6.dailySignals ?? [], dataFingerprint: p6.dataFingerprint },
  };
}
