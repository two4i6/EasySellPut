import { qqqEbDailyAdmissions } from './qqqEbDailyAdmission';
/** CPU worker for the independent EB7/P6 arms of the composite replay. */
import { parentPort } from 'node:worker_threads';
import { buildQqqEb7E175DynamicReplayWithData } from './QqqEb7E175DynamicReplay';
import { buildQqqEb7E209DynamicReplayWithData } from './QqqEb7E209DynamicReplay';
import { buildQqqEb6DynamicReplayWithData } from './QqqEb6DynamicReplay';
import { buildQqqP4DynamicReplayWithData, qqqCanonicalOptionSignalWarmupStartDate } from './QqqP4DynamicReplay';
import { QQQ_P6_E385_OPTIONS } from './QqqEb7E175P6E385R9E226Contract';
import { QQQ_P6_E218_OPTIONS } from './QqqEb7E175P6E218R9E221Contract';
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';

export type QqqEb7P6R9WorkerJob = {
  kind: 'EB7' | 'EB6' | 'P6';
  equityBoostMode?: 'EB7.E175' | 'EB7.E209' | 'EB6.E209';
  pcsMode?: 'E385' | 'E218';
  startDate: string;
  endDate: string;
  data: MarketDataSet;
};

export type QqqEb7P6R9WorkerResult = {
  kind: QqqEb7P6R9WorkerJob['kind'];
  dataFingerprint: string;
  cycles?: Awaited<ReturnType<typeof buildQqqEb7E175DynamicReplayWithData>>['cycles'];
  dailySignals?: Awaited<ReturnType<typeof buildQqqP4DynamicReplayWithData>>['dailySignals'];
  tradeLog?: Awaited<ReturnType<typeof buildQqqP4DynamicReplayWithData>>['tradeLog'];
};

parentPort?.on('message', async (job: QqqEb7P6R9WorkerJob) => {
  try {
    if (job.kind === 'EB7' || job.kind === 'EB6') {
      if (job.kind === 'EB6') {
        const replay = await buildQqqEb6DynamicReplayWithData(job.startDate, job.endDate, job.data);
        parentPort?.postMessage({ kind: job.kind, dataFingerprint: replay.dataFingerprint, cycles: replay.cycles, dailySignals: qqqEbDailyAdmissions(replay.upstream.raw, replay.cycles) } satisfies QqqEb7P6R9WorkerResult);
        return;
      }
      const buildEb7 = job.equityBoostMode === 'EB7.E209' ? buildQqqEb7E209DynamicReplayWithData : buildQqqEb7E175DynamicReplayWithData;
      const replay = await buildEb7(job.startDate, job.endDate, job.data, {
        canonicalOptionSignalTapeShared: true,
        highRecoveryTrace: false,
        lowRecoveryTrace: false,
        intermediateRecoveryTrace: false,
        skipIntermediateMtm: true,
      });
      parentPort?.postMessage({ kind: job.kind, dataFingerprint: replay.dataFingerprint, cycles: replay.cycles, dailySignals: qqqEbDailyAdmissions(replay.admissionRaw, replay.cycles) } satisfies QqqEb7P6R9WorkerResult);
      return;
    }

    const replay = await buildQqqP4DynamicReplayWithData(job.startDate, job.endDate, job.data, { ...(job.pcsMode === 'E218' ? QQQ_P6_E218_OPTIONS : QQQ_P6_E385_OPTIONS), trace: false, canonicalOptionSignalStartDate: qqqCanonicalOptionSignalWarmupStartDate(job.startDate) });
    parentPort?.postMessage({ kind: job.kind, dataFingerprint: replay.dataFingerprint, tradeLog: replay.tradeLog, dailySignals: replay.dailySignals } satisfies QqqEb7P6R9WorkerResult);
  } catch (error) {
    parentPort?.postMessage({ error: error instanceof Error ? error.stack ?? error.message : String(error) });
  }
});
