/** Shared opt-in execution contract for the uncapped R2465 EPR sleeve. */
import type {QqqSpreadAdapterConfig} from '../qqq-spread-adapter-v2';
import {R2465_CLOSING_COMMISSION_MODE,R2465_OBSERVATION_DTES} from './r2465-simplified-v2';
export function withR2465ExecutionContract<T extends {portfolioConfig:QqqSpreadAdapterConfig;
  definitions:Array<{id:string;config:QqqSpreadAdapterConfig}>}>(composition:T,extraDtes:readonly number[]=[]):T{
  if(composition.portfolioConfig.coordinated?.version!==undefined&&composition.portfolioConfig.coordinated.version!=='ordered-fill-v1')throw Error('Strict R research prohibits concurrent opening policies');
  const putTargetDtes=[...new Set([...R2465_OBSERVATION_DTES,...extraDtes])].sort((a,b)=>a-b);
  const extended=putTargetDtes.some(d=>d>75)?{putMaturityMode:'extended-365-v1' as const}:{};
  const unbudgeted=(config:QqqSpreadAdapterConfig)=>{const {policyMarginBudgetVersion:_removed,...rest}=config;return rest;};
  return {...composition,portfolioConfig:{...unbudgeted(composition.portfolioConfig),closingCommissionMode:R2465_CLOSING_COMMISSION_MODE,putTargetDtes:[...new Set([...(composition.portfolioConfig.putTargetDtes??[]),...putTargetDtes])].sort((a,b)=>a-b),...extended},
    definitions:composition.definitions.map(book=>book.id==='r9'
      ?{...book,config:{...unbudgeted(book.config),closingCommissionMode:R2465_CLOSING_COMMISSION_MODE,putTargetDtes,...extended}}:book)};
}
