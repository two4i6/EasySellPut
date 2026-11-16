/** Shared-framework initialization of the declared P6 observation contract. */
import type {MarketDataSet} from '../engines/leveraged-overlay/v2/backtest/fixtures';
import {P6_E385_EFFECTIVE_PARAMETERS as p,P6_E385_NATIVE_SOURCE_CONTRACT,p6NativeSourceOptions} from './strategies/p6-e385-parameters-v2';
import {createNativeSourceSpec} from './native-source-initialization-v2';
export const P6_E385_SOURCE_CONTRACT_VERSION=P6_E385_NATIVE_SOURCE_CONTRACT.version;
export function resolveP6E385SourceContract(data:MarketDataSet,startDate:string,endDate:string){
  const {spec:nativeSpec,resolvedEndDate}=createNativeSourceSpec(data,startDate,endDate,
    P6_E385_NATIVE_SOURCE_CONTRACT.policy,p6NativeSourceOptions());
  return {version:P6_E385_SOURCE_CONTRACT_VERSION,requestedWindow:{startDate,endDate},resolvedEndDate,
    nativeSpec,parameters:p,dataFingerprint:data.fingerprint,
    executionMigration:{complete:true,missing:[],researchOnly:true,liveCapacityValidated:false}};
}
