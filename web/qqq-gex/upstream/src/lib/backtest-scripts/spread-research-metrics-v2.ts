/** Shared reporting convention; financial P&L and MDD come from the independent account audit. */
export function spreadTradeStatistics(pnls: readonly number[]) {
  if (pnls.some(p => !Number.isFinite(p))) throw new Error('Nonfinite settled trade P&L');
  const sorted = [...pnls].sort((a,b) => a-b), wins = pnls.filter(p => p > 0).length;
  const tail = Math.max(1,Math.ceil(pnls.length*.05));
  return { trades:pnls.length, wins, losses:pnls.length-wins,
    winRatePct:pnls.length ? wins/pnls.length*100 : null, worst:sorted[0] ?? null,
    cvar5:sorted.length ? sorted.slice(0,tail).reduce((a,b)=>a+b,0)/tail : null };
}

/** Account CAGR uses the complete initial NAV, including idle cash. A collateral
 * efficiency ratio is not account CAGR. Endpoints use the declared calendar sample;
 * a same-day sample has no annualization. No interest is credited to idle cash.
 */
export function spreadAccountAnnualization(window:{startDate:string;endDate:string},initialCapital:number,endingEquity:number) {
  const valid=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  if(!valid(window.startDate)||!valid(window.endDate)||window.startDate>window.endDate
    ||!Number.isFinite(initialCapital)||initialCapital<=0||!Number.isFinite(endingEquity))throw Error('Invalid account annualization inputs');
  const years=(Date.parse(window.endDate)-Date.parse(window.startDate))/(365.25*86400000),pnl=endingEquity-initialCapital;
  return {initialCapital,endingEquity,accountReturnPct:100*pnl/initialCapital,calendarYears:years,
    cagrPct:years>0&&endingEquity>=0?100*((endingEquity/initialCapital)**(1/years)-1):null,
    annualizedPnlDollars:years>0?pnl/years:null,annualizationMethod:'calendar-endpoints-act-365.25' as const};
}
