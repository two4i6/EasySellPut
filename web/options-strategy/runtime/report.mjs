import {createHostEngine} from '../../app-sdk/engine-host.mjs';
const engine=await createHostEngine();
try {
 const {request}=engine;
 if(request.context.appId!=='easysellput.options-strategy'||!["get_expirations", "get_option_chain", "analyze_strategy", "get_saved_strategies", "save_strategy", "delete_strategy", "analyze_option_chain", "get_pricing_assumptions", "get_volatility_insights", "record_option_snapshot", "build_strategy", "strategy_what_if"].includes(request.operation)) {
  engine.finish({$appError:{code:'invalid_arguments',message:'Unsupported options/strategy operation'}});
 } else {
  try {engine.finish(await engine.call(request.operation,request.arguments));}
  catch(error){engine.finish({$appError:{code:error.code??'invalid_data',message:String(error.message??'Source failed').slice(0,1000)}});}
 }
} finally {engine.close();}
