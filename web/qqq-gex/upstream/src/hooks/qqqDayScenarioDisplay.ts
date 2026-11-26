import type { DayScenarioField, DayScenarioInput } from '@/lib/qqqDayScenario';

export type DayScenarioReply = {key:string;context:string;field?:DayScenarioField;input?:DayScenarioInput;error?:string};

/** The displayed field always keeps its own observation time and coverage. */
export function dayScenarioDisplay(key:string,context:string,cached:DayScenarioField|undefined,reply:DayScenarioReply|null,cachedInput?:DayScenarioInput,currentInput?:DayScenarioInput) {
  const current=cached??(reply?.key===key?reply.field:undefined);
  const error=reply?.key===key?reply.error??null:null;
  const pending=!current&&!error;
  const hasInput=!currentInput||Number.isFinite(currentInput.observationAt)&&Number.isFinite(currentInput.spot)&&currentInput.spot>0&&currentInput.expiries.some(expiry=>expiry.fullGexProfile.length>0);
  const retained=pending&&hasInput&&reply?.context===context&&reply.field&&!reply.field.reason?reply.field:null;
  const field=current??retained??null;
  const input=field===cached?cachedInput:field===reply?.field?reply.input:undefined;
  return {field,input:input??null,error,pending,retained:!!retained};
}
