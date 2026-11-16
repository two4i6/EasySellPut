/**
 * 自动 Roll 策略引擎 (Auto-Roll Engine)
 */

import { type OptionContract, type OptionChain, optionChainEngine } from '../pricing/OptionChainEngine';
import { isITM, calcProfitRatio } from '../shared/tradeUtils';
import { DELTA, DTE, PROFIT } from '../shared/constants';

export interface RollInstruction {
  shouldRoll: boolean;
  type: 'PROFIT_CLOSE' | 'DEFENSIVE_ROLL' | 'TIME_ROLL' | 'NONE';
  newLegs?: { contract: OptionContract; side: 'Buy' | 'Sell' }[];
  reason?: string;
}

/**
 * 模拟交易定义 (内联以避免反向依赖 services)
 */
export interface SimulatedTrade {
  symbol: string;
  entryDate: string;
  exitDate?: string;
  entryPrice: number;
  exitPrice?: number;
  creditReceived: number;
  size: number;
  pnl: number;
  status: 'open' | 'closed';
  currentValue: number;
  strategy: string;
  reason: string;
  legs: { contract: OptionContract; side: 'Buy' | 'Sell' }[];
}

export class RollEngine {
  private static instance: RollEngine;

  public static getInstance(): RollEngine {
    if (!RollEngine.instance) {
      RollEngine.instance = new RollEngine();
    }
    return RollEngine.instance;
  }

  /**
   * 扫描持仓并判断是否触发滚动逻辑
   */
  public evaluatePosition(
    trade: SimulatedTrade, 
    currentChain: OptionChain, 
    vix: number
  ): RollInstruction {
    const spot = currentChain.underlyingPrice;
    
    // 1. 获取当前头寸的核心腿 (Short Leg)
    const shortLeg = trade.legs.find(l => l.side === 'Sell');
    if (!shortLeg) return { shouldRoll: false, type: 'NONE' };
    
    const currentContract = shortLeg.contract;
    
    // 计算实时 DTE (基于当前回测日期)
    const dte = this.calculateRemainingDTE(trade.entryDate, currentChain.date, currentContract.dte);

    // --- 触发器 1: 盈利触发 (Profit Taking) ---
    const totalCredit = trade.creditReceived * 100 * (trade.size || 1);
    const profitRatio = calcProfitRatio(trade.pnl, totalCredit);
    if (profitRatio >= PROFIT.CLOSE_MID) {
      return { shouldRoll: true, type: 'PROFIT_CLOSE', reason: `Profit target reached (${(PROFIT.CLOSE_MID * 100).toFixed(0)}%), early close` };
    }

    // --- 触发器 2: Delta 触发 (最核心防御) ---
    // 获取当前合约在当前链中的实时 Delta
    const liveContract = this.findLiveContract(currentChain, currentContract);
    if (liveContract) {
      const absDelta = Math.abs(liveContract.delta);
      if (absDelta >= DELTA.CRITICAL) {
        return this.decideRollAction(trade, currentChain, `Danger: Delta breached ${DELTA.CRITICAL}, forced roll`);
      }
      if (absDelta >= DELTA.WARNING) {
        return this.decideRollAction(trade, currentChain, `Warning: Delta breached ${DELTA.WARNING}, defensive roll`);
      }
    }

    // --- 触发器 3: 价格触发 (Strike Touch) ---
    const isPut = currentContract.type === 'Put';
    const isCall = currentContract.type === 'Call';

    if (isPut && isITM(spot, currentContract.strike)) {
      return this.decideRollAction(trade, currentChain, 'Price breached short Put strike');
    }
    if (isCall && spot >= currentContract.strike) {
      return this.decideRollAction(trade, currentChain, 'Price breached short Call strike');
    }

    // --- 触发器 4: 时间触发 (DTE Management) ---
    if (dte < DTE.WARNING) {
      return this.decideRollAction(trade, currentChain, `DTE < ${DTE.WARNING}, time decay risk, rolling out`);
    }

    return { shouldRoll: false, type: 'NONE' };
  }

  /**
   * 决定如何滚动：寻找新的行权价和到期日
   */
  private decideRollAction(trade: SimulatedTrade, chain: OptionChain, reason: string): RollInstruction {
    const shortLeg = trade.legs.find(l => l.side === 'Sell');
    const isPutSide = shortLeg ? shortLeg.contract.type === 'Put' : trade.strategy.toLowerCase().includes('put');
    
    // 目标：滚动到下一个 30-45 天周期，并将 Delta 重新设为 0.20
    const targetDTE = 45;
    const targetDelta = isPutSide ? -0.20 : 0.20;

    const newShort = optionChainEngine.findContract(chain, targetDTE, targetDelta, isPutSide ? 'Put' : 'Call');
    if (!newShort) return { shouldRoll: false, type: 'NONE' };

    // 保持原来的价差宽度
    const shortLegOriginal = trade.legs.find(l => l.side === 'Sell');
    const longLegOriginal = trade.legs.find(l => l.side === 'Buy');

    if (shortLegOriginal && longLegOriginal) {
      const oldWidth = Math.abs(shortLegOriginal.contract.strike - longLegOriginal.contract.strike);
      const newLongStrike = isPutSide ? (newShort.strike - oldWidth) : (newShort.strike + oldWidth);
      
      const newLong = chain.expirations
        .find(e => e.dte === newShort.dte)?.options
        .find(o => o.strike === newLongStrike && o.type === (isPutSide ? 'Put' : 'Call'));

      if (newShort && newLong) {
        return {
          shouldRoll: true,
          type: 'DEFENSIVE_ROLL',
          reason,
          newLegs: [
            { contract: newShort, side: 'Sell' },
            { contract: newLong, side: 'Buy' }
          ]
        };
      }
    } else {
      // Single leg CSP roll
      return {
        shouldRoll: true,
        type: 'DEFENSIVE_ROLL',
        reason,
        newLegs: [
          { contract: newShort, side: 'Sell' }
        ]
      };
    }

    return { shouldRoll: false, type: 'NONE' };
  }

  private calculateRemainingDTE(entryDate: string, currentDate: string, initialDTE: number): number {
    const elapsed = (new Date(currentDate).getTime() - new Date(entryDate).getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0, initialDTE - elapsed);
  }

  private findLiveContract(chain: OptionChain, original: OptionContract): OptionContract | undefined {
    return chain.expirations
      .flatMap(e => e.options)
      .find(o => o.strike === original.strike && o.type === original.type);
  }
}

export const rollEngine = RollEngine.getInstance();
