import type { QqqGammaModel } from './qqqGammaModel';
import { qqqFrozenReferenceUsable } from './qqqMarketSession';

export function qqqGammaModelPresentation(model: QqqGammaModel | undefined, options: { historical?: boolean; stale?: boolean; loading?: boolean; now?: number } = {}) {
  const waiting = (title: string, detail: string, stale = false) => ({ title, detail, nextStep: null, context: '', regime: '', canCheckEntry: false, stale });
  if (options.loading) return waiting('先等模型更新', '新快照就绪后，再对照 K 线观察价格位置。');
  if (!model?.points.length || model.spotGamma===null) return waiting('先等有效数据', model?.reason ?? '期权持仓和 IV 数据就绪后，才能观察模型价位。');
  const now=options.now ?? Date.now();
  const sourceAge=model.sourceAsOf===null ? Infinity : (now-Date.parse(model.sourceAsOf))/1000;
  const priceAge=(now-Date.parse(model.asOf))/1000;
  const stale=!options.historical && (options.stale || !Number.isFinite(sourceAge) || !Number.isFinite(priceAge) || sourceAge<0 || priceAge<0 || sourceAge>360 || priceAge>240);
  if (!options.historical && qqqFrozenReferenceUsable(model.sourceAsOf, now, model.nearestExpiry ?? undefined)) return {
    title:'收盘模型参考', detail:`源快照 ${model.sourceAsOf}；价位保留供盘前/盘后对照。`,
    nextStep:null,context:'冻结参考不代表当前期权结构或入场资格。',regime:'收盘参考',canCheckEntry:false,stale:true,
  };
  if(stale) return waiting('先等新快照', '当前价位来自旧数据；更新后再查看 Gamma 位置副图。', true);
  const regime=model.spotGamma>0 ? '波动缓冲倾向' : model.spotGamma<0 ? '波动放大倾向' : 'Gamma 接近平衡';
  const trigger=model.volatilityTrigger;
  const zeroGamma=model.levels.zeroGamma;
  const zeroLocation=zeroGamma===null ? '零交点未识别' : model.spot<zeroGamma ? `参考价低于零交点 ${Math.abs(zeroGamma-model.spot).toFixed(2)}` : model.spot>zeroGamma ? `参考价高于零交点 ${Math.abs(model.spot-zeroGamma).toFixed(2)}` : '参考价位于零交点';
  const location=trigger.price===null ? 'VT 缓冲区未识别' : model.spot<trigger.price ? `距 VT 下沿 ${Math.abs(trigger.price-model.spot).toFixed(2)}` : model.spot===trigger.price ? '参考价触及 VT 下沿' : trigger.bandEnd!==null && trigger.bandEnd!==undefined && model.spot<=trigger.bandEnd ? '参考价位于 VT 缓冲区' : trigger.bandEnd!==null && trigger.bandEnd!==undefined ? '参考价高于识别出的缓冲区（VT）' : '参考价高于 VT 下沿（图上仅标下沿）';
  const context=`${zeroLocation}；${location}。仅描述模型波动结构，不代表涨跌方向、支撑阻力或入场信号。`;
  const zeroWatch=zeroGamma===null ? '零交点尚未识别，先观察 K 线的波动变化。' : `留意价格穿过零交点 ${zeroGamma.toFixed(2)} 后，波动是否发生变化。`;
  let title: string, detail: string, nextStep: string;
  if (model.spotGamma < 0) {
    title='先观察突破是否延续';
    detail='在 K 线上看突破或回落后，价格是否继续向同一方向移动。';
    nextStep=zeroWatch;
  } else if (trigger.price===null) {
    title='先观察零交点附近的变化';
    detail=zeroWatch;
    nextStep='缓冲区尚未识别，先等下一次模型更新。';
  } else if (model.spot<=trigger.price) {
    title='先看能否站上缓冲下沿';
    detail=`观察价格能否站上 ${trigger.price.toFixed(2)}，以及后续 K 线是否保持在上方。`;
    nextStep=zeroWatch;
  } else if (trigger.bandEnd!==null && trigger.bandEnd!==undefined && model.spot<=trigger.bandEnd) {
    title='观察回落是否仍在缓冲区';
    detail=`回落时，留意价格是否仍高于下沿 ${trigger.price.toFixed(2)}。`;
    nextStep='若跌出缓冲区，重新查看副图与 K 线的波动变化。';
  } else if (trigger.bandEnd!==null && trigger.bandEnd!==undefined) {
    title='先观察缓冲区外的走势';
    detail=`价格已高于缓冲区上沿 ${trigger.bandEnd.toFixed(2)}，观察后续是继续远离还是回到区内。`;
    nextStep='回到区内后，再看价格能否保持在缓冲下沿上方。';
  } else {
    title='观察下沿上方能否保持';
    detail=`留意后续 K 线是否仍高于 ${trigger.price.toFixed(2)}；目前只识别出下沿。`;
    nextStep=zeroWatch;
  }
  return { title:options.historical ? `历史回看 · ${title}` : title, detail, nextStep, context, regime, canCheckEntry:!options.historical, stale:false };
}
