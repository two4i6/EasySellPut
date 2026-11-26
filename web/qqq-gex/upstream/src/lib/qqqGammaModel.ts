import { qqqSessionForDate } from './qqqMarketSession';
import { qqqDirectionalGexTime } from './qqqDirectionalGexTime';
import { qqqIvUsable } from './qqqIvQuality';
export const QQQ_GAMMA_INPUT_VERSION = 'qqq-gamma-usable-iv-v2';

export type GammaModelStrike = { strike: number; callOi?: number; putOi?: number; callIv?: number; putIv?: number; callReceivedAt?: string; putReceivedAt?: string; inputComplete?: boolean; computedAt?: string; calculationVersion?: string; gexUnit?: string; callInputComplete?: boolean; putInputComplete?: boolean };
export type GammaModelExpiry = { expiryDate: string; asOf: string; fullGexProfile: readonly GammaModelStrike[] };
export type QqqGammaModel = {
  asOf: string; sourceAsOf: string | null; spot: number; expiries: string[]; excluded: string[]; nearestExpiry: string | null; inputQualityVersion?: string;
  points: Array<{ price: number; gamma: number; grossGamma: number; exNearest: number | null }>;
  levels: { callWall: number | null; putWall: number | null; absoluteGamma: number | null; zeroGamma: number | null };
  spotGamma: number | null; reason: string | null;
  dataTimes?: {receivedAt:string|null;quoteAsOf:null;oiAsOf:null;valuationAt:string;availableAt:string|null};
  sensitivity?: {ivShockPct:number;timeShiftSeconds:number;zeroGamma:{low:number|null;high:number|null;missingScenarios:number};volatilityTrigger:{low:number|null;high:number|null;missingScenarios:number}};
  volatilityTrigger: { price: number | null; bandEnd?: number | null; version: 'net-gamma-cushion-v3'; boundaryMethod?: 'continuous' | 'sampled-linear'; reason: string };
};

export const QQQ_VOLATILITY_TRIGGER_POLICY = Object.freeze({ version: 'net-gamma-cushion-v3' as const,
  minNetToGross: .10, minPeakFraction: .10, minBandWidthPct: .0025 });

/** Research hypothesis: lower edge of a sustained, material positive-gamma cushion. */
export function deriveQqqVolatilityTrigger(points: readonly { price: number; gamma: number; grossGamma: number }[], spot: number, evaluate?: (price:number)=>{gamma:number;grossGamma:number}) {
  const policy = QQQ_VOLATILITY_TRIGGER_POLICY;
  const unavailable = (reason: string) => ({ price: null, bandEnd: null, version: policy.version, reason });
  if (!(spot > 0) || !Number.isFinite(spot) || points.length < 2 || points.some((p, i) => !Number.isFinite(p.price) || !Number.isFinite(p.gamma) || !Number.isFinite(p.grossGamma) || p.grossGamma < Math.abs(p.gamma) - 1e-6 || (i > 0 && p.price <= points[i - 1]!.price))) return unavailable('缺少有效 Gamma 情景曲线');
  const peak = Math.max(0, ...points.map(p => p.gamma));
  if (peak <= 0) return unavailable('当前价格情景范围内没有正 Gamma 缓冲区');
  const margins = (p: typeof points[number]) => [p.gamma - peak * policy.minPeakFraction, p.gamma - p.grossGamma * policy.minNetToGross];
  const margin = (p: typeof points[number]) => Math.min(...margins(p));
  // Solve each linear inequality separately: interpolating their minimum can put
  // an alleged entry outside one of the two qualifying constraints.
  const crossing = (a: typeof points[number], b: typeof points[number], entering: boolean) => {
    if (evaluate) {
      let lo=a.price,hi=b.price;
      for(let n=0;n<40;n++) {
        const mid=(lo+hi)/2,value=evaluate(mid);
        if(!Number.isFinite(value.gamma)||!Number.isFinite(value.grossGamma))return NaN;
        const qualifies=margin({...value,price:mid})>=0;
        if(qualifies===entering)hi=mid;else lo=mid;
      }
      // Return the qualifying side, including the upper exit boundary.
      return entering?hi:lo;
    }
    const left = margins(a), right = margins(b);
    const fractions = left.flatMap((v,i) => (v < 0) !== (right[i]! < 0) ? [-v / (right[i]! - v)] : []);
    const fraction = entering ? Math.max(...fractions) : Math.min(...fractions);
    return a.price + (b.price - a.price) * fraction;
  };
  const bands: Array<{ start: number; end: number | null }> = [];
  let start: number | null = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!, previous = points[i - 1];
    if (margin(p) >= 0) {
      if (start === null) {
        // A band beginning at the sampled boundary has no observable lower edge.
        if (!previous || margin(previous) >= 0) continue;
        start = crossing(previous,p,true);
      }
    } else if (start !== null) {
      const end = crossing(previous!,p,false);
      if (end - start >= spot * policy.minBandWidthPct) bands.push({ start, end });
      start = null;
    }
  }
  if (start !== null && points.at(-1)!.price - start >= spot * policy.minBandWidthPct) bands.push({ start, end: null });
  if (!bands.length) return unavailable('没有找到具有可辨识下边界的持续正 Gamma 缓冲区');
  const distance = (band: typeof bands[number]) => spot < band.start ? band.start - spot : band.end !== null && spot > band.end ? spot - band.end : 0;
  bands.sort((a, b) => distance(a) - distance(b) || Math.abs(a.start - spot) - Math.abs(b.start - spot));
  return { price: bands[0]!.start, bandEnd: bands[0]!.end, version: policy.version, boundaryMethod: evaluate?'continuous' as const:'sampled-linear' as const, reason: '净 Gamma ≥ 采样正峰值的 10%，净/总 Gamma ≥ 10%，缓冲区宽度 ≥ 现价的 0.25%；取最近缓冲区下边界' };
}

/** Model horizon is QQQ option last-trading time (16:15 ET / 13:15 early close), not OCC exercise deadline. */
const expiryTimes=new Map<string,number>();
export function qqqGammaExpiryTime(date: string): number {
  const cached=expiryTimes.get(date);if(cached!==undefined)return cached;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) return NaN;
  const session = qqqSessionForDate(date);
  if (!session.trading) return NaN;
  const noon = new Date(`${date}T12:00:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(noon).map(p => [p.type, p.value]));
  const value=noon.getTime() + (session.optionCloseMinute - Number(parts.hour) * 60 - Number(parts.minute)) * 60_000;
  expiryTimes.set(date,value);while(expiryTimes.size>128)expiryTimes.delete(expiryTimes.keys().next().value!);
  return value;
}

export type QqqPreparedGammaContract = { strike: number; oi: number; iv: number; t: number; sign: number; expiry: string; expiryTime: number; volTime: number; drift: number; factor: number };

/** A single observed contract. Missing inputs never become a zero position. */
export function prepareQqqGammaContract(strike:number,oi:unknown,iv:unknown,sign:number,expiry:string,observedAt:number):QqqPreparedGammaContract|null {
  const expiryTime=qqqGammaExpiryTime(expiry),t=(expiryTime-observedAt)/(365*86400_000);
  if(!(t>0)||!(typeof oi==='number'&&Number.isFinite(oi)&&oi>0)||!qqqIvUsable(iv)||!(strike>0)||!Number.isFinite(strike))return null;
  const volTime=iv*Math.sqrt(t),drift=.5*iv*iv*t,factor=oi/(Math.sqrt(2*Math.PI)*volTime);
  return volTime>0&&[volTime,drift,factor,factor*strike].every(Number.isFinite)?{strike,oi,iv,t,sign,expiry,expiryTime,volTime,drift,factor}:null;
}

/** Validate against observation time only. Projection time never admits later inputs. */
export function prepareQqqGammaInventory(expiries: readonly GammaModelExpiry[], spot: number, asOf: string) {
  const result: QqqGammaModel = { asOf, sourceAsOf: null, spot, expiries: [], excluded: [], nearestExpiry: null, points: [], inputQualityVersion: QQQ_GAMMA_INPUT_VERSION,
    levels: { callWall: null, putWall: null, absoluteGamma: null, zeroGamma: null }, spotGamma: null, reason: null,
    dataTimes:{receivedAt:null,quoteAsOf:null,oiAsOf:null,valuationAt:asOf,availableAt:null},
    volatilityTrigger: { price: null, version: QQQ_VOLATILITY_TRIGGER_POLICY.version, reason: '缺少有效 Gamma 情景曲线' } };
  const now = Date.parse(asOf);
  if (!(spot > 0) || !Number.isFinite(spot) || !Number.isFinite(now)) return { result: { ...result, reason: '缺少有效价格或快照时间' }, contracts: [] as QqqPreparedGammaContract[] };
  type Contract = QqqPreparedGammaContract;
  const contracts: Contract[] = [];
  let allReceiptsKnown=true;
  for (const expiry of [...expiries].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))) {
    const t = (qqqGammaExpiryTime(expiry.expiryDate) - now) / (365 * 86400_000);
    const pending: Contract[] = [];
    const sourceAsOf = qqqDirectionalGexTime(expiry.asOf, null, expiry.fullGexProfile);
    let valid = t > 0 && expiry.fullGexProfile.length > 0 && expiry.fullGexProfile.every(p => p.inputComplete !== false) && Number.isFinite(Date.parse(expiry.asOf)) && Date.parse(expiry.asOf) <= now && Date.parse(sourceAsOf) <= now;
    // Strict model excludes this entire expiry. Preparing contracts that will
    // immediately be discarded adds work to every historical capture.
    if(!valid){result.excluded.push(expiry.expiryDate);continue;}
    for (const p of expiry.fullGexProfile) {
      for (const [oi, iv, sign] of [[p.callOi, p.callIv, 1], [p.putOi, p.putIv, -1]]) {
        if (oi === 0) continue;
        if (!(typeof oi === 'number' && Number.isFinite(oi) && oi > 0 && qqqIvUsable(iv) && p.strike > 0 && Number.isFinite(p.strike))) { valid = false; continue; }
        const contract=prepareQqqGammaContract(p.strike,oi,iv,sign!,expiry.expiryDate,now);
        if(!contract||!Number.isFinite(contract.factor*spot)){valid=false;continue;}
        pending.push(contract);
      }
    }
    if (!valid || !pending.length) { result.excluded.push(expiry.expiryDate); continue; }
    result.expiries.push(expiry.expiryDate); contracts.push(...pending);
    if(expiry.fullGexProfile.some(p=>Number(p.callOi)>0&&!Number.isFinite(Date.parse(p.callReceivedAt??''))||Number(p.putOi)>0&&!Number.isFinite(Date.parse(p.putReceivedAt??''))))allReceiptsKnown=false;
    if(result.dataTimes!.availableAt===null||Date.parse(sourceAsOf)>Date.parse(result.dataTimes!.availableAt!))result.dataTimes!.availableAt=sourceAsOf;
    const sourceTimes = expiry.fullGexProfile.flatMap(p=>[
      ...(Number(p.callOi)>0 ? [p.callReceivedAt ?? expiry.asOf] : []), ...(Number(p.putOi)>0 ? [p.putReceivedAt ?? expiry.asOf] : []),
    ]).filter((v):v is string=>typeof v==='string' && Number.isFinite(Date.parse(v)));
    const oldestSource = sourceTimes.length ? sourceTimes.reduce((a,b)=>Date.parse(a)<Date.parse(b)?a:b) : sourceAsOf;
    if (result.sourceAsOf === null || Date.parse(oldestSource) < Date.parse(result.sourceAsOf)) result.sourceAsOf = oldestSource;
  }
  result.dataTimes!.receivedAt=allReceiptsKnown?result.sourceAsOf:null;
  if (!contracts.length) return { result: { ...result, reason: '缺少完整 OI / IV，或快照时该到期日已到期' }, contracts };
  result.nearestExpiry = result.expiries[0]!;
  return { result, contracts };
}

/** Fixed strike IV and OI, r=q=0; same kernel for curve and time/price surface. */
export function qqqGammaContractAt(c: QqqPreparedGammaContract, valuationAt: number): QqqPreparedGammaContract | null {
  const t = (c.expiryTime - valuationAt) / (365 * 86400_000);
  if (!(t > 0)) return null;
  const volTime=c.iv*Math.sqrt(t), drift=.5*c.iv*c.iv*t;
  const factor=c.oi/(Math.sqrt(2*Math.PI)*volTime);
  return [volTime,drift,factor].every(Number.isFinite)&&volTime>0 ? {...c,t,volTime,drift,factor} : null;
}

export function qqqGammaContractExposure(c: QqqPreparedGammaContract, price: number, logMoneyness=Math.log(price/c.strike)) {
  const d1=(logMoneyness+c.drift)/c.volTime;
  return Math.exp(-.5*d1*d1)*c.factor*price;
}

/** Display-only scenario model: fixed OI/strike IV, r=q=0, calls positive and puts negative. */
export function buildQqqGammaModel(expiries: readonly GammaModelExpiry[], spot: number, asOf: string, options:{includeSensitivity?:boolean}={}): QqqGammaModel {
  const {result,contracts}=prepareQqqGammaInventory(expiries,spot,asOf);
  if (!contracts.length) return result;
  const now=Date.parse(asOf);
  const exposure=qqqGammaContractExposure;
  const evaluations=new Map<number,{price:number;gamma:number;grossGamma:number;exNearest:number|null}>();
  const evaluate=(price:number)=>{
    const cached=evaluations.get(price);if(cached)return cached;
    let gamma=0,grossGamma=0,remaining=0;
    for(const c of contracts){const value=exposure(c,price);grossGamma+=value;gamma+=c.sign*value;if(c.expiry!==result.nearestExpiry)remaining+=c.sign*value;}
    const value={price,gamma,grossGamma,exNearest:result.expiries.length>1?remaining:null};evaluations.set(price,value);return value;
  };
  const at = (s: number) => evaluate(s).gamma;
  const byStrike = new Map<number, { call: number; put: number }>();
  for (const c of contracts) {
    const totals = byStrike.get(c.strike) ?? { call: 0, put: 0 };
    totals[c.sign > 0 ? 'call' : 'put'] += exposure(c, spot); byStrike.set(c.strike, totals);
  }
  const levels = [...byStrike.entries()].sort((a, b) => a[0] - b[0]);
  const largest = (measure: (v: { call: number; put: number }) => number) => levels.reduce<{ strike: number | null; value: number }>((best, [strike, v]) => measure(v) > best.value ? { strike, value: measure(v) } : best, { strike: null, value: 0 }).strike;
  result.levels.callWall = largest(v => v.call); result.levels.putWall = largest(v => v.put);
  result.levels.absoluteGamma = largest(v => v.call + v.put);
  // Concentrate the scenario grid around spot and the principal concentrations.
  const anchors = [spot, result.levels.callWall, result.levels.putWall, result.levels.absoluteGamma].filter((v): v is number => v !== null);
  const low = Math.max(spot * .5, Math.min(spot * .97, ...anchors) - spot * .005);
  const high = Math.max(spot * 1.03, ...anchors) + spot * .005;
  // Resolve narrow near-expiry concentrations as well as the broad scenario range.
  const localPrices = contracts.flatMap(c => {
    const width = c.strike * c.iv * Math.sqrt(c.t);
    if (width >= (high-low)/160 * 2) return [];
    return [-2,-1,-.5,0,.5,1,2].map(n => c.strike + n * width).filter(p => p >= low && p <= high);
  });
  const prices = [...new Set([...Array.from({ length: 161 }, (_, i) => low + (high - low) * i / 160), ...anchors, ...localPrices])].sort((a, b) => a - b);
  result.points = prices.map(evaluate);
  if(result.points.some(p=>![p.price,p.gamma,p.grossGamma,p.exNearest??0].every(Number.isFinite)))
    return {...result,points:[],levels:{callWall:null,putWall:null,absoluteGamma:null,zeroGamma:null},reason:'Gamma 计算超出有效数值范围'};
  result.volatilityTrigger = deriveQqqVolatilityTrigger(result.points, spot, evaluate);
  result.spotGamma = at(spot);
  const roots: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const a = result.points[i - 1]!, b = result.points[i]!;
    // A zero caused by tail underflow is not a sign change. Only bracketed,
    // nonzero opposite signs define a flip; handle an isolated exact zero below.
    if (a.gamma !== 0 && b.gamma !== 0 && Math.sign(a.gamma) !== Math.sign(b.gamma)) {
      let left = a.price, right = b.price, leftGamma = a.gamma;
      for (let n = 0; n < 32; n++) {
        const mid = (left + right) / 2, gamma = at(mid);
        if (gamma === 0) { left = mid; right = mid; break; }
        if (Math.sign(gamma) === Math.sign(leftGamma)) { left = mid; leftGamma = gamma; } else right = mid;
      }
      roots.push((left + right) / 2);
    }
  }
  for (let i=1;i<result.points.length-1;i++) {
    const previous=result.points[i-1]!, p=result.points[i]!, next=result.points[i+1]!;
    if (p.gamma===0 && p.grossGamma>0 && previous.gamma!==0 && next.gamma!==0 && Math.sign(previous.gamma)!==Math.sign(next.gamma)) roots.push(p.price);
  }
  result.levels.zeroGamma = result.points.every(p => p.gamma === 0) ? null : roots.sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))[0] ?? null;
  if(options.includeSensitivity) {
    const shocks=[.95,1.05].map(scale=>buildQqqGammaModel(expiries.map(e=>({...e,fullGexProfile:e.fullGexProfile.map(p=>({...p,callIv:typeof p.callIv==='number'?p.callIv*scale:p.callIv,putIv:typeof p.putIv==='number'?p.putIv*scale:p.putIv}))})),spot,asOf));
    shocks.push(buildQqqGammaModel(expiries,spot,new Date(now+60_000).toISOString()));
    const range=(values:(number|null)[])=>{const valid=values.filter((p):p is number=>p!==null&&Number.isFinite(p));return{low:valid.length?Math.min(...valid):null,high:valid.length?Math.max(...valid):null,missingScenarios:values.length-valid.length};};
    result.sensitivity={ivShockPct:5,timeShiftSeconds:60,zeroGamma:range([result.levels.zeroGamma,...shocks.map(m=>m.levels.zeroGamma)]),volatilityTrigger:range([result.volatilityTrigger.price,...shocks.map(m=>m.volatilityTrigger.price)])};
  }
  return result;
}
