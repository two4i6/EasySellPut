import {createHostEngine} from '../../app-sdk/engine-host.mjs';
const engine=await createHostEngine();
try {
 const {request}=engine;
 if(request.context.appId!=='easysellput.news-fundamentals'||!['get_news','get_fundamentals','get_financials'].includes(request.operation)) {
  engine.finish({$appError:{code:'invalid_arguments',message:'Unsupported news operation'}});
 } else {
  try {engine.finish(await engine.call(request.operation,request.arguments));}
  catch(error){engine.finish({$appError:{code:error.code??'invalid_data',message:String(error.message??'Source failed').slice(0,1000)}});}
 }
} finally {engine.close();}
