import { qqqIvUsable, qqqStrikeHasIvFloor } from './qqqIvQuality';
type InputStrike = {
  calculationVersion?: string; gexUnit?: string;
  inputComplete?: boolean; callInputComplete?: boolean; putInputComplete?: boolean;
  callOi?: number; putOi?: number;
  callIv?: number; putIv?: number;
  callReceivedAt?: string; putReceivedAt?: string;
};
type InputProfile = { strikes: readonly InputStrike[]; time?: number };
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Both retained schemas preserve absent OI; versions remain distinct for deltas. */
export function qqqLosslessGexDefinitionSupported(point: unknown): boolean {
  if (!point || typeof point !== 'object') return false;
  const metadata = point as Pick<InputStrike, 'calculationVersion' | 'gexUnit'>;
  return metadata.gexUnit === 'per-1pct' && (metadata.calculationVersion === 'qqq-gex-full-1pct-v3' || metadata.calculationVersion === 'qqq-gex-full-1pct-usable-iv-v4');
}

/** A saved side is independent of the opposite side, but only lossless schemas
 * establish its units and missing-field meaning. A normalized aggregate requires
 * explicit bilateral or side-specific complete inputs from model evaluation;
 * an unverified incomplete zero remains a placeholder. */
export function qqqGexDisplaySideValid(point:InputStrike&{callGex?:number;putGex?:number},side:'call'|'put'){
 const normalizedComplete=point.calculationVersion==='qqq-exposure-gamma-model-v1'&&point.gexUnit==='per-1pct'&&(point.inputComplete===true||point[`${side}InputComplete`]===true);
 if(!qqqLosslessGexDefinitionSupported(point)&&!normalizedComplete)return false;
 const oi=point[`${side}Oi`],iv=point[`${side}Iv`],value=point[`${side}Gex`];
 return nonnegative(oi)&&nonnegative(value)&&(oi===0?value===0:qqqIvUsable(iv));
}

/** Display-only validation of a saved strike. Full-chain model eligibility stays separate. */
export function qqqGexDisplayStrikeValid(point: InputStrike): boolean {
  return displayStrikeValid(point, false);
}

/** Saved observations verify bilateral inputs without copying strike metadata. */
export function qqqGexObservationStrikeValid(point: InputStrike): boolean {
  return displayStrikeValid(point, qqqLosslessGexDefinitionSupported(point));
}

function displayStrikeValid(point: InputStrike, requireInputs: boolean): boolean {
  if (qqqStrikeHasIvFloor(point)) return false;
  if (point.inputComplete !== false && !requireInputs) return true;
  // Only the current capture schema preserves missing OI instead of inventing zero.
  if (!qqqLosslessGexDefinitionSupported(point)) return false;
  return (['call', 'put'] as const).every(side => {
    const oi=point[`${side}Oi`], iv=point[`${side}Iv`];
    return nonnegative(oi) && (oi===0 || qqqIvUsable(iv));
  });
}

/** Explain an explicitly incomplete capture without imputing missing inputs.
 * Legacy profiles without quality metadata remain unknown, not incomplete.
 * A missing side is not a missing contract unless saved side metadata exists. */
export function qqqGexInputQuality(profiles: readonly InputProfile[], cutoff = Infinity): string | null {
  let incomplete = false, missingOi = 0, missingIv = 0;
  for (const profile of profiles) {
    if (profile.time !== undefined && (!Number.isFinite(profile.time) || profile.time > cutoff)) continue;
    if (!profile.strikes.some(point => point.inputComplete === false || qqqStrikeHasIvFloor(point))) continue;
    incomplete = true;
    for (const point of profile.strikes) {
      for (const side of ['call', 'put'] as const) {
        const oi = point[`${side}Oi`], iv = point[`${side}Iv`];
        const present = iv !== undefined || point[`${side}ReceivedAt`] !== undefined || oi !== undefined;
        if (present && !nonnegative(oi)) missingOi++;
        else if (nonnegative(oi) && oi > 0 && !qqqIvUsable(iv)) missingIv++;
      }
    }
  }
  if (!incomplete) return null;
  const reasons = [missingOi ? `${missingOi} 个合约缺少有效持仓量（OI）` : '', missingIv ? `${missingIv} 个合约缺少有效隐含波动率（IV）` : ''].filter(Boolean);
  return `期权链不完整：${reasons.join('，') || '部分输入未通过完整性检查'}。仅显示输入有效的行权价，缺失部分留空；完整链汇总与完整持仓模型等待完整采集。`;
}
