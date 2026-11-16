import { QQQ_GAMMA_INPUT_VERSION, buildQqqGammaModel, type GammaModelExpiry, type QqqGammaModel } from './qqqGammaModel';

export type QqqGammaModelJob = { key:string;date:string;asOf:string;spot:number;selectedExpiry:string|null;expiries:readonly GammaModelExpiry[];availableModel?:QqqGammaModel };
export type QqqGammaModels = {selected:QqqGammaModel;available:QqqGammaModel};

/** Same valuation function and causal inputs as the synchronous display model. */
export function runQqqGammaModelJob(job:QqqGammaModelJob):QqqGammaModels {
  const active=job.expiries.find(expiry=>expiry.expiryDate===job.selectedExpiry);
  const selected=buildQqqGammaModel(active?[active]:[],job.spot,job.asOf);
  const cached = job.availableModel;
  const available=(cached?.inputQualityVersion===QQQ_GAMMA_INPUT_VERSION && cached.asOf===job.asOf && cached.spot===job.spot ? cached : undefined)??(job.expiries.length===1&&active===job.expiries[0]?selected:buildQqqGammaModel(job.expiries,job.spot,job.asOf));
  return {selected,available};
}
