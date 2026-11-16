'use client';
import { qqqGexInputQuality } from '@/lib/qqqGexInputQuality';
import { useQqqGammaModels } from '@/hooks/useQqqGammaModels';
import type { QqqPcsApiResponse } from '@/types/qqqGex';
import { useQqqTerminalTabVisible } from '../QqqTerminalWorkspace';
import { QqqGammaModelPanel } from './QqqGammaModelPanel';
import QqqExposureSummary from './QqqExposureSummary';
import type { QqqExposureReplayContext } from '@/lib/qqqExposureReplay';
import { useMemo } from 'react';
import { qqqGammaObservationInput, qqqGammaObservationCoverage } from '@/lib/qqqGammaObservationInput';

export default function QqqGammaObservation({data,selectedExpiry,lockedScope,historical,loading,replay}:{data:QqqPcsApiResponse;selectedExpiry:string|null;lockedScope?:'selected'|'available';historical:boolean;loading:boolean;replay?:QqqExposureReplayContext|null}) {
  const visible=useQqqTerminalTabVisible();
  const observation=useMemo(()=>qqqGammaObservationInput(data),[data]);
  const computed=useQqqGammaModels(observation.data,selectedExpiry,visible);
  const activeExpiry=selectedExpiry??data.intraday?.gexExpiries?.[0]?.expiryDate;
  const partial=lockedScope==='available'?observation.coverage.size>0:Boolean(activeExpiry&&observation.coverage.has(activeExpiry));
  const selectedCoverage=qqqGammaObservationCoverage(data,observation.coverage,activeExpiry,lockedScope==='available');
  const scenarioCoverage=partial?`${selectedCoverage.valid}/${selectedCoverage.total}`:undefined;
  const profiles=replay?(replay.frame?.profiles??[]):(data.intraday?.gexExpiries??[]).filter(expiry=>lockedScope==='available'||expiry.expiryDate===(selectedExpiry??data.intraday?.gexExpiries?.[0]?.expiryDate)).map(expiry=>({strikes:expiry.fullGexProfile,time:Date.parse(expiry.asOf)}));
  const quality=qqqGexInputQuality(profiles,replay?.frame?.time??Date.parse(data.observedAt??data.asOf));
  return <div aria-busy={computed.loading||loading}>
    <QqqExposureSummary replay={replay??null} model={partial?undefined:computed.models?.[lockedScope??'selected']} />
    {computed.error&&<div role="status">{computed.error}</div>}
    <QqqGammaModelPanel scenarioCoverage={scenarioCoverage} partial={partial} inputQuality={quality} models={computed.models??undefined} lockedScope={lockedScope} historical={historical} loading={loading||computed.loading} stale={data.dataStatus!=='LIVE'}/>
  </div>;
}
