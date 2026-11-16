/** Shared stress_only_dynamic_v1 selection mechanism. Activation, geometry, objective
 * and veto thresholds belong to strategies; supplied source pools stay distinct. */
import {candidateSigmasForPcsSurvivalSelection} from '../engines/leveraged-overlay/v2/strategies/pcs-survival-selector';
import {selectIndexedPcsCandidate} from './pcs-selection-v5';
type SelectionInput = Parameters<typeof selectIndexedPcsCandidate>[0];
export function stressOnlyPcsSelectionProfile(stressed:boolean) {
  const mode = stressed ? 'dynamic_v1_survival' as const : 'survival_only' as const;
  const baseSigma = stressed ? 2.5 as const : undefined;
  return {mode,candidateSigmas:candidateSigmasForPcsSurvivalSelection(mode,baseSigma),baseSigma};
}
export function selectStressOnlyPcsCandidate(input:Omit<SelectionInput,'mode'|'baseSigma'|'candidateSigmas'|'filterSigma'> & {
  stressed:boolean; pool:'profile'|'supplied'; geometry?:{widthPct:number;error:string};
}) {
  const {stressed,pool,geometry,...policy}=input;
  if(geometry && policy.candidates.some(candidate=>candidate.widthPct!==geometry.widthPct))
    throw new Error(geometry.error);
  return selectIndexedPcsCandidate({...stressOnlyPcsSelectionProfile(stressed),...policy,
    filterSigma:pool==='profile' && stressed ? 2.5 : undefined});
}
