'use client';
import { useEffect, useMemo, useState } from 'react';
import type { QqqPcsApiResponse, PcsFullGexProfile } from '@/types/qqqGex';
import type { QqqExposureReplayContext } from '@/lib/qqqExposureReplay';
import { useQqqIntradayContext } from './useQqqIntradayContext';
import { EMPTY_OBSERVATION_BARS, EMPTY_OBSERVATION_EXPIRIES, EMPTY_OBSERVATION_FRAMES, prepareQqqOptionObservations, qqqObservationPrefix, qqqObservationSpotIndex, qqqOptionObservationCutoff, type QqqObservationTrack } from '@/lib/qqqOptionObservationHistory';
import { qqqEasternDateKey } from '@/lib/qqqMarketDate';
import { mergeExposureBars } from '@/lib/qqqExposureBars';
import { qqqSnapshotAtmIv } from '@/lib/qqqAtmIvObservation';
import { qqqRegularObservationCutoff } from '@/lib/qqqIntradayIndicators';

/** Compose shared reference transport and cooperative source preparation.
 * Cursor changes only select a prepared prefix; hidden tabs cancel work.
 */
export function useQqqIntradayStudy(data: QqqPcsApiResponse, replay: QqqExposureReplayContext | null, selectedExpiry: string | null, enabled: boolean, withHistory: boolean, regularOnly = false) {
  const date = data.view.date ?? qqqEasternDateKey(data.asOf), allExpiries = data.intraday?.gexExpiries ?? EMPTY_OBSERVATION_EXPIRIES;
  const expiry = selectedExpiry ?? replay?.selectedExpiry ?? allExpiries[0]?.expiryDate ?? null;
  const dte = expiry ? Math.round((Date.parse(expiry) - Date.parse(date)) / 86400_000) : 0;
  const context = useQqqIntradayContext(date, 0, enabled && withHistory, 'volume');
  const sourceBars = replay?.bars ?? data.intraday?.bars ?? EMPTY_OBSERVATION_BARS;
  const bars = useMemo(() => mergeExposureBars(context.data?.currentBars ?? EMPTY_OBSERVATION_BARS, sourceBars), [context.data?.currentBars, sourceBars]);
  const spotAt = useMemo(() => qqqObservationSpotIndex(bars, date), [bars, date]);
  const observationCutoff = qqqOptionObservationCutoff(Date.parse(data.observedAt ?? data.asOf), replay);
  const cutoff = regularOnly ? qqqRegularObservationCutoff(date, observationCutoff) : observationCutoff;
  const sourceFrames = replay?.rawFrames ?? replay?.frames ?? EMPTY_OBSERVATION_FRAMES;
  const input = useMemo(() => ({ expiries: allExpiries.filter(item => item.expiryDate === expiry), frames: sourceFrames.map(frame => ({ ...frame, profiles: frame.profiles.filter(profile => profile.expiry === expiry) })), date }), [allExpiries, sourceFrames, date, expiry]);
  const [prepared, setPrepared] = useState<{ input: typeof input; tracks: QqqObservationTrack<{ profile: PcsFullGexProfile[] }>[] } | null>(null);
  const [failure, setFailure] = useState<typeof input | null>(null);
  const ready = prepared?.input === input;
  useEffect(() => {
    if (!enabled || ready) return;
    const controller = new AbortController();
    void prepareQqqOptionObservations(input.expiries, input.frames, input.date, controller.signal, profile => ({ profile })).then(tracks => {
      if (!controller.signal.aborted) { setPrepared({ input, tracks }); setFailure(null); }
    }).catch(() => { if (!controller.signal.aborted) setFailure(input); });
    return () => controller.abort();
  }, [input, enabled, ready]);
  const snapshot = useMemo(() => ready ? qqqObservationPrefix(prepared!.tracks.find(track => track.expiry === expiry)?.history ?? [], cutoff).at(-1) ?? null : null, [ready, prepared, expiry, cutoff]);
  const iv = useMemo(() => snapshot ? qqqSnapshotAtmIv(snapshot.profile, spotAt(snapshot.time)) || null : null, [snapshot, spotAt]);
  return { date, expiry, dte, cutoff, observationCutoff, bars, spot: spotAt(cutoff), snapshot, iv, ivAt: snapshot?.time ?? null, context,
    preparing: enabled && !ready && failure !== input, preparationError: failure === input ? '期权快照整理失败，请切换到期日后重试。' : null };
}
