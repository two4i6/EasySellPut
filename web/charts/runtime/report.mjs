import {createHostEngine} from '../../app-sdk/engine-host.mjs';
const engine=await createHostEngine();
try {
 const {request}=engine;
 if(request.context.appId!=='easysellput.charts'||!["get_bars", "get_chart_analysis", "get_market_events", "get_chart_drawings", "add_chart_drawing", "update_chart_drawing", "delete_chart_drawing", "clear_chart_drawings"].includes(request.operation)) {
  engine.finish({$appError:{code:'invalid_arguments',message:'Unsupported chart operation'}});
 } else {
  try {engine.finish(await engine.call(request.operation,request.arguments));}
  catch(error){engine.finish({$appError:{code:error.code??'invalid_data',message:String(error.message??'Source failed').slice(0,1000)}});}
 }
} finally {engine.close();}
