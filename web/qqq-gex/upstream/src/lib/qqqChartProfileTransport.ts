/** Lossless transport: null and an absent field have different meanings. */
export const QQQ_CHART_PROFILE_FIELDS = ['strike','callGex','putGex','totalGex','callOi','putOi','callVolume','putVolume','callIv','putIv','callReceivedAt','putReceivedAt','isCallWall','isPutWall','isGammaFlip','calculationVersion','gexUnit','inputComplete','computedAt','sourceAsOf'] as const;
export const QQQ_MODEL_PROFILE_FIELDS = ['strike','callOi','putOi','callIv','putIv','callReceivedAt','putReceivedAt','inputComplete','computedAt'] as const;
export function decodeQqqChartProfile(value: unknown, fields: readonly string[]): Record<string,unknown>[] {
  const packed = value as {version?:unknown;columns?:unknown;rows?:unknown};
  if (!packed || packed.version !== 1 || !Array.isArray(packed.columns) || !Array.isArray(packed.rows)
    || packed.columns.length !== fields.length || !packed.columns.every((key,i)=>key===fields[i])) throw Error('Invalid chart profile transport');
  return packed.rows.map((row:unknown)=>{
    if (!Array.isArray(row) || row.length !== fields.length+1 || !Number.isInteger(row[0]) || row[0]<0 || row[0]>=2**fields.length) throw Error('Invalid chart profile row');
    const point:Record<string,unknown>={};
    fields.forEach((key,i)=>{if(row[0] & 2**i)point[key]=row[i+1];});
    return point;
  });
}
