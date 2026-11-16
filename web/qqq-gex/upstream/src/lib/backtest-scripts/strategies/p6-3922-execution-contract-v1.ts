/** Fixed quote surface and zero actual fees used by the frozen P6.3922 research. */
import type {QqqSpreadAdapterConfig} from '../qqq-spread-adapter-v2';
export const P6_3922_TARGET_DTES=Object.freeze([14,21,28,35,42,49] as const);
export function p63922ExecutionConfig(config:QqqSpreadAdapterConfig):QqqSpreadAdapterConfig{
 return {...config,commissionPerContract:0,putTargetDtes:[...new Set([...(config.putTargetDtes??[28,35]),...P6_3922_TARGET_DTES])].sort((a,b)=>a-b),
  ...(config.fillRetry?{fillRetry:{...config.fillRetry,commissionPerContract:0}}:{})};
}
/** Extend only actual/P quote books. E/R source quote/execution contracts remain pinned. */
export function withP63922ExecutionContract<T extends {portfolioConfig:QqqSpreadAdapterConfig;
 definitions:Array<{id:string;config:QqqSpreadAdapterConfig}>}>(composition:T):T{
 return {...composition,portfolioConfig:p63922ExecutionConfig(composition.portfolioConfig),
  definitions:composition.definitions.map(book=>book.id==='p6'?{...book,config:p63922ExecutionConfig(book.config)}:book)};
}
