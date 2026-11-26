// Compatibility adapter: source acquisition and financial math remain shared, not copied.
import {createHostEngine} from '../../app-sdk/engine-host.mjs';
const engine = await createHostEngine();
try {
  const {request} = engine;
  if (request.context.appId !== 'easysellput.market-liquidity' || request.operation !== 'get_market_liquidity' || Object.keys(request.arguments).length) {
    engine.finish({$appError:{code:'invalid_arguments',message:'Unsupported liquidity request'}});
  } else {
    try {
      // The host invokes the existing shared service directly, never redispatches this module.
      engine.finish(await engine.call('get_market_liquidity', {}));
    } catch (error) {
      engine.finish({$appError:{code:error.code ?? 'invalid_data',message:String(error.message ?? 'Liquidity source failed').slice(0,1000)}});
    }
  }
} finally {
  engine.close();
}
