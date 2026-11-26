import { FactorMap } from "../../../types/factor";
import { FactorEngine } from "../../FactorEngine";
import { isITM, isNearITM } from "../shared/tradeUtils";
import { DELTA, DTE, PROFIT } from "../shared/constants";

export type CSPAction = "HOLD" | "ROLL" | "CLOSE";
export type CSPPriority = "low" | "medium" | "high" | "urgent";

export interface CSPDecision {
  action: CSPAction;
  priority: CSPPriority;
  confidence: number;
  reason: string[];
  suggestedRoll?: {
    newStrike: number;
    newDTE: number;
  };
}

/**
 * CSP Execution Decision Engine
 * Integrates risk warnings and market environment to produce final actionable advice
 */
export class CSPExecutionEngine extends FactorEngine {
  public getDecision(
    factors: FactorMap,
    vix: number = 20,
    currentPrice: number = 0,
    shortStrike: number = 0,
    dte: number = 30,
    currentDelta: number = 0.15,
    unrealizedPnLPercent: number = 0
  ): CSPDecision {
    let action: CSPAction = "HOLD";
    let priority: CSPPriority = "low";
    const reasons: string[] = [];

    // If position already closed, return HOLD
    if (factors.is_closed?.value === true) {
      return { action: "HOLD", priority: "low", confidence: 1, reason: ["Trade already cleared"] };
    }

    // Core Metrics
    const currentlyITM = isITM(currentPrice, shortStrike);
    const currentlyNearITM = isNearITM(currentPrice, shortStrike);
    const absDelta = Math.abs(currentDelta);
    const isHighDelta = absDelta > DELTA.EXECUTION;
    const isTakeProfit = unrealizedPnLPercent >= PROFIT.CLOSE_HIGH * 100;
    const isNearExpiry = dte < DTE.WARNING;

    // --- Decision Logic Layer ---

    // 1. CLOSE Scenario: Absolute risk or absolute profit
    if (isTakeProfit) {
      action = "CLOSE";
      priority = "medium";
      reasons.push(`Profit target (${(PROFIT.CLOSE_HIGH * 100).toFixed(0)}%) reached, recommend closing`);
    } else if (currentlyITM && isNearExpiry) {
      action = "CLOSE";
      priority = "urgent";
      reasons.push("ITM and near expiry, extreme Gamma risk, close or accept assignment");
    }

    // 2. ROLL Scenario: Salvageable risk or trend reversal
    if (action !== "CLOSE") {
      if (isHighDelta && dte > DTE.WARNING) {
        action = "ROLL";
        priority = "high";
        reasons.push(`Delta breached ${DELTA.EXECUTION.toFixed(2)} but time remaining, suggest Roll Down and Out`);
      } else if (currentlyNearITM || absDelta > DELTA.WATCH) {
        action = "ROLL";
        priority = "medium";
        reasons.push(currentlyNearITM ? "Price near strike, suggest Roll for safety buffer" : "Trend reversal, suggest Roll to mitigate risk");
      }
    }

    // 3. Conflict Resolution: If both TP and NEAR_ITM, prioritize ROLL (keep position with buffer)
    if (isTakeProfit && currentlyNearITM) {
      action = "ROLL";
      priority = "medium";
      reasons.push("Profitable but price approaching, Roll is optimal for risk/reward");
    }

    // Calculate final confidence based on multiple risk factors
    let confidence = 0.9;
    if (vix > 35) confidence -= 0.1;
    if (isHighDelta) confidence -= 0.15;
    if (currentlyITM) confidence -= 0.2;
    if (isNearExpiry) confidence -= 0.1;
    // ensure confidence doesn't go below 0.1 and has max 2 decimal places
    confidence = Math.round(Math.max(0.1, confidence) * 100) / 100;

    // Assemble decision
    const decision: CSPDecision = { 
      action, 
      priority, 
      confidence, 
      reason: reasons.length ? reasons : ["Market stable, continue holding"] 
    };

    if (action === "ROLL") {
      const atr = (factors.atr?.value as number) || 0;
      let newStrike;
      if (atr > 0 && currentPrice > 0) {
        // Roll strike out of 1.5 ATR for safety buffer
        newStrike = Math.floor(currentPrice - atr * 1.5);
      } else {
        // Fallback static percentage roll
        const ROLL_OTM_BUFFER = 0.05;
        newStrike = Math.floor(currentPrice * (1 - ROLL_OTM_BUFFER));
      }

      decision.suggestedRoll = {
        newStrike,
        newDTE: 14, // Default 2 week roll
      };
    }

    return decision;
  }
}

export const cspExecutionEngine = new CSPExecutionEngine();
