import { buildDayScenario, type DayScenarioInput, type DayScenarioMode, type DayScenarioPolicy } from './qqqDayScenario';

// The client sends one job at a time and keeps only its latest pending cursor.
const worker=self as unknown as {onmessage:(event:MessageEvent<{key:string;input:DayScenarioInput;mode:DayScenarioMode;policy?:DayScenarioPolicy}>)=>void;postMessage:(value:unknown,transfer?:Transferable[])=>void};
worker.onmessage=({data})=>{
  try {
    const field=buildDayScenario(data.input,data.mode,data.policy);
    worker.postMessage({key:data.key,field},[field.values.buffer]);
  } catch { worker.postMessage({key:data.key,error:'日内情景计算失败，请重试'}); }
};
