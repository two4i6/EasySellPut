/** EB8 promotes the accepted rounded/factored policy without changing its decisions. */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule} from '../strategy-module-v2';
import {eb7E209PrunedV1 as frozen} from './eb7-e209-pruned-v1';
export const EB8_PARAMS=freezeStrategyData({...frozen.params,parent:'EB7.E209.PRUNE',source:'EB8',
  lineage:['EB7.E209','EB7.E209.PRUNE','EB8']});
export const eb8StandaloneV1:BarStrategyModule={
  manifest:{sdkVersion:2,id:'EB8',version:'eb8-rounded-factored-v1',researchOnly:true,
    migration:{complete:true,missing:[]}},
  params:EB8_PARAMS,
  initialize(params){assertFixedStrategyParams(params,EB8_PARAMS);return frozen.initialize(frozen.params);},
  onFeedback(input){
    assertFixedStrategyParams(input.params,EB8_PARAMS);
    return frozen.onFeedback!({...input,params:frozen.params});
  },
  onBar(input){assertFixedStrategyParams(input.params,EB8_PARAMS);return frozen.onBar({...input,params:frozen.params});},
};
