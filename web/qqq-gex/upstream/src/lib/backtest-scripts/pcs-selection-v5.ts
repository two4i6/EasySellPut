/** Shared candidate-pool mechanics; callers own geometry, filters, objectives and veto policy. */
import {selectPcsSurvivalCandidate,type PcsSigma} from '../engines/leveraged-overlay/v2/strategies/pcs-survival-selector';
type SelectionInput=Parameters<typeof selectPcsSurvivalCandidate>[0];
export function selectIndexedPcsCandidate(input:SelectionInput&{filterSigma?:PcsSigma}){
  const {filterSigma,...policy}=input;
  const indices:number[]=[],candidates:SelectionInput['candidates'][number][]=[];
  input.candidates.forEach((candidate,index)=>{
    if(filterSigma===undefined||candidate.sigma===filterSigma){indices.push(index);candidates.push(candidate);}
  });
  const result=selectPcsSurvivalCandidate({...policy,candidates});
  return result?{...result,selectedIndex:indices[result.selectedIndex]!}:result;
}
