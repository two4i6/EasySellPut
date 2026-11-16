/** Framework composition of declared E209 source initialization, never admission rules. */
import type { MarketDataSet } from '../engines/leveraged-overlay/v2/backtest/fixtures';
import { E209_SOURCE_BOOKS,E209_NATIVE_SOURCE_CONTRACT,e209NativeSourcePolicy } from './strategies/e209-source-contract-v1';
import { resolveSpreadExecutionConfig } from './spread-execution-config-v3';
import { createNativeSourceSpec } from './native-source-initialization-v2';
export const E209_SOURCE_CONTRACT_VERSION=E209_NATIVE_SOURCE_CONTRACT.version;
export const E209_E1_WARMUP_FULL_CALENDAR_YEARS=E209_NATIVE_SOURCE_CONTRACT.e1WarmupFullCalendarYears;
export function resolveE209SourceContract(data:MarketDataSet,startDate:string,endDate:string){
  const sources=Object.fromEntries(E209_SOURCE_BOOKS.map(id=>[id,createNativeSourceSpec(data,startDate,endDate,
    e209NativeSourcePolicy(id))]));
  const nativeSpecs=Object.fromEntries(E209_SOURCE_BOOKS.map(id=>[id,sources[id]!.spec]));
  const native=nativeSpecs[E209_NATIVE_SOURCE_CONTRACT.contextSource]!.config;
  const config=resolveSpreadExecutionConfig(native,startDate,sources[E209_NATIVE_SOURCE_CONTRACT.contextSource]!.resolvedEndDate,{});
  return {version:E209_SOURCE_CONTRACT_VERSION,e1ScreenStart:sources['e1-screen']!.sourceStart,
    c4ScreenStart:sources['c4-screen']!.sourceStart,nativeSpecs,config};
}
