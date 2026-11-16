/** P6 strategy-side selector. Adapter supplies only unselected, as-of analytical candidate facts. */
import type { PcsSurvivalSelectionCandidate } from '../../engines/leveraged-overlay/v2/strategies/pcs-survival-selector';
import {selectStressOnlyPcsCandidate} from '../pcs-selection-v6';
import { isPcsContractProfileStressed } from '../../engines/leveraged-overlay/v2/strategies/pcs-contract-profile';
import { P6_E385_EFFECTIVE_PARAMETERS as p,P6_E385_SOURCE_SELECTION } from './p6-e385-parameters-v2';
export type P6SelectionObservation = {
  asOf: string; regime: string; slowSubregime: string; adx14?: number; rv20?: number;
  primaryVol?: number; primaryVol3m?: number; annualizedQqqRv20?: number;
  candidates: readonly PcsSurvivalSelectionCandidate[];
};
export function p6E385Width(slowSubregime: string) {
  return slowSubregime === 'SR01' ? p.widthBySlowSubregime.SR01
    : slowSubregime === 'SR02' ? p.widthBySlowSubregime.SR02 : p.baseWidthPct;
}
export function p6E385SelectionScope(observation: Omit<P6SelectionObservation, 'candidates'>) {
  const stressed = isPcsContractProfileStressed({ regime: observation.regime, vix: observation.primaryVol,
    vix3m: observation.primaryVol3m, annualizedRv20: observation.annualizedQqqRv20 });
  const objectiveActive = observation.regime === p.selection.objectiveRegime
    && observation.slowSubregime === p.selection.objectiveSlowSubregime
    && Number.isFinite(observation.rv20) && observation.rv20! >= p.selection.objectiveRv20Min;
  const tailVetoActive = stressed && observation.regime === p.selection.stressTailVetoRegime
    && observation.slowSubregime === p.selection.stressTailVetoSlowSubregime
    && Number.isFinite(observation.rv20) && observation.rv20! < p.selection.stressTailVetoRv20Max;
  return { stressed, objectiveActive, tailVetoActive, width: p6E385Width(observation.slowSubregime) };
}
export function selectP6E385Contract(observation: P6SelectionObservation) {
  const { stressed, objectiveActive, tailVetoActive } = p6E385SelectionScope(observation);
  // Inherited stress_only_dynamic_v1 is active: stressed bars use profile sigma=2.5 only.
  // Keep the supplied probe pool identical to native stressed construction.
  return selectStressOnlyPcsCandidate({stressed,pool:'profile',
    geometry:{widthPct:p6E385Width(observation.slowSubregime),error:'P6 candidate geometry differs from declared current-bar width'},
    floor: p.selection.survivalFloor, objective: objectiveActive ? p.selection.objective : undefined,
    survivalWeight: p.selection.survivalWeight, survivalWilsonWeight: p.selection.wilsonWeight,
    tailVetoRatio: tailVetoActive ? p.selection.stressTailVetoRatio : undefined,
    candidates: observation.candidates });
}

/** Canonical source's VIX-coordinate contract, rebuilt causally instead of reading its tape. */
export function selectP6SourceContract(observation: P6SelectionObservation) {
  const stressed = isPcsContractProfileStressed({ regime: observation.regime, vix: observation.primaryVol,
    vix3m: observation.primaryVol3m, annualizedRv20: observation.annualizedQqqRv20 });
  return selectStressOnlyPcsCandidate({stressed,pool:'supplied',
    ...P6_E385_SOURCE_SELECTION,
    candidates: observation.candidates });
}
