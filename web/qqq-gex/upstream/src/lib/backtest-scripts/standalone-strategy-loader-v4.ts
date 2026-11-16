/** Literal, trusted lazy branches. Identity pins this entire file AND the selected closure. */
import type {BarStrategyModule} from './strategy-module-v2';
import {standaloneStrategyPaths} from './standalone-strategy-catalog-v4';
export {standaloneStrategyPaths} from './standalone-strategy-catalog-v4';
export function loadStandaloneStrategy(id:keyof typeof standaloneStrategyPaths):BarStrategyModule{
  switch(id){
    case 'EB8.412':return require('./strategies/eb8-412-standalone-v1').eb8412StandaloneV1;
    case 'EB8.3896':return require('./strategies/eb8-3896-standalone-v1').eb83896StandaloneV1;
    case 'EB8.1298':return require('./strategies/eb8-1298-standalone-v1').eb81298StandaloneV1;
    case 'EB8.940':return require('./strategies/eb8-940-standalone-v1').eb8940StandaloneV1;
    case 'EB8.411':return require('./strategies/eb8-411-standalone-v1').eb8411StandaloneV1;
    case 'EB8.1':return require('./strategies/eb8-1-standalone-v1').eb81StandaloneV1;
    case 'EB8':return require('./strategies/eb8-standalone-v1').eb8StandaloneV1;
    case 'EB7.E209':return require('./strategies/eb7-e209-causal-v6').eb7E209CausalV6;
    case 'EB.SIMPLE':return require('./strategies/eb-simple-standalone-v1').ebSimpleStandaloneV1;
    case 'EB7.E209.PRUNE':return require('./strategies/eb7-e209-pruned-v1').eb7E209PrunedV1;
    case 'P6.E385':return require('./strategies/p6-3922-standalone-v1').p63922StandaloneV1;
    case 'R9.E226':return require('./strategies/r9-e226-standalone-v4').r9E226StandaloneV4;
    case 'PCS.EPR':return require('./strategies/pcs-epr-standalone-v23').pcsEprStandaloneV23;
    case 'PCS.EPR.PRUNE':return require('./strategies/pcs-epr-pruned-v1').pcsEprPrunedV1;
    case 'CCS.C3.E856':return require('./strategies/ccs-c3-e856-standalone-v1').ccsC3E856StandaloneV1;
    default:throw Error('Unknown registered strategy');
  }
}
