import type{StrategyObject}from'../../strategy-module-v2';
import type{CompiledAdmission}from'./admission-policy-v19';import{evaluateLogic}from'./boolean-runtime-v14';
export function evaluateE209ResidualStage(input:{context:Readonly<StrategyObject>;e0Admitted:boolean;residualEligible:boolean},compiled:CompiledAdmission){
 if(input.e0Admitted)return{admitted:true,reason:'E0-parent'};if(!input.residualEligible)return{admitted:false,reason:'upstream-unavailable'};
 const rule=['E2','E3','E4','E5','E6','E7','E8'].find(id=>evaluateLogic(compiled.logic,'residual.'+id,input.context));return{admitted:!!rule,reason:rule??'residual-no-match'};
}
