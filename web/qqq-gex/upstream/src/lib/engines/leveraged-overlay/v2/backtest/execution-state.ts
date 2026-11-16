/** 回测日循环持有的股票账本；所有成交仍经统一 execution helper 写入。 */
export type PortfolioState = {
  leveragedShares: number;
  leveragedCostBasis: number;
  boxxShares: number;
  boxxCostBasis: number;
  cash: number;
};

export function createPortfolioState(initialCapital: number): PortfolioState {
  return {
    leveragedShares: 0,
    leveragedCostBasis: 0,
    boxxShares: 0,
    boxxCostBasis: 0,
    cash: initialCapital,
  };
}
