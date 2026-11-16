/** Native research execution assumptions -> shared adapter contract. No strategy choices. */
import type {ResolvedBacktestRunSpec} from '../engines/leveraged-overlay/v2/backtest/run-spec';
import {QQQ_SPREAD_ADAPTER_DEFAULTS,type QqqSpreadAdapterConfig} from './qqq-spread-adapter-v2';
import {EXECUTION_AVAILABILITY_VERSION} from './execution-availability-v1';
export function resolveSpreadExecutionConfig(config:ResolvedBacktestRunSpec['config'],startDate:string,endDate:string,
  contract:'native-spread'|'adapter-default-spread'|Readonly<Pick<QqqSpreadAdapterConfig,'terminalOpenAtClose'|'terminalMarkOnly'>&{
    executionVersion?:string;intrabarStops?:boolean}>='native-spread'):QqqSpreadAdapterConfig {
  // Explicit standalone contracts use the SDK model/cost defaults, never replay-preset inheritance.
  if(typeof contract==='object'){
    const {executionVersion,intrabarStops,...sample}=contract;
    if(executionVersion!==undefined&&executionVersion!==EXECUTION_AVAILABILITY_VERSION
      ||intrabarStops!==undefined&&intrabarStops!==false)throw Error('Unsupported spread execution timing contract');
    return {...QQQ_SPREAD_ADAPTER_DEFAULTS,pricing:{...QQQ_SPREAD_ADAPTER_DEFAULTS.pricing},
      liquidityModel:false,startDate,endDate,...sample};
  }
  if(contract==='adapter-default-spread')return {...QQQ_SPREAD_ADAPTER_DEFAULTS,startDate,endDate,
    initialCapital:config.initialCapital,commissionPerContract:config.commissionPerContract??.65,
    realStrikeGrid:config.realStrikeGrid??false,liquidityModel:config.liquidityModel??false};
  return {...QQQ_SPREAD_ADAPTER_DEFAULTS,startDate,endDate,initialCapital:config.initialCapital,
    commissionPerContract:config.commissionPerContract??.65,realStrikeGrid:config.realStrikeGrid??false,
    liquidityModel:config.liquidityModel??false,pricing:{spreadMultiplier:config.optionSpreadMultiplier??1,
      skewSlope:config.optionSkewSlope??QQQ_SPREAD_ADAPTER_DEFAULTS.pricing.skewSlope,riskFreeRate:config.riskFreeRate??.045},
    terminalOpenAtClose:config.appendTerminalPcsOpen??false,terminalMarkOnly:config.includeTerminalMarkOnly??false};
}
