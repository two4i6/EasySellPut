/**
 * APR (Annualized Percentage Rate) calculation utilities for Option strategies.
 * Standardizes the way we calculate annualized returns across the application.
 */

/**
 * Calculates the Maximum APR for a CSP strategy.
 * Maximum APR represents the return if the option is held to expiration 
 * with the full premium retained.
 */
export function calculateMaxCSPAPR(premium: number, strike: number, dte: number): number {
  if (strike <= 0 || dte <= 0 || premium <= 0) return 0;

  // Max APR based on full premium retention relative to strike (or margin requirement)
  // For simple max APR, we use strike as the capital denominator.
  const capital = strike;
  return (premium / capital) * (365 / dte) * 100;
}

/**
 * Calculates the APR for a Cash Secured Put (CSP) strategy.
 * 
 * Formula: (Premium / Net Capital) * (365 / DTE) * 100
 * Net Capital = Strike - Premium
 * 
 * @param premium The premium received for the option (per share, e.g., 1.50)
 * @param strike The strike price of the option (e.g., 150)
 * @param dte Days to Expiration
 * @returns Annualized percentage (e.g., 15.5)
 */
export function calculateCSPAPR(premium: number, strike: number, dte: number): number {
  if (strike <= 0 || dte <= 0 || premium <= 0) return 0;
  
  // Use a floor for net capital to avoid division by zero or negative results
  // net capital = strike - premium (since we receive premium immediately)
  const netCapital = Math.max(strike - premium, strike * 0.005);
  
  // (Return / Investment) * (Days in Year / Duration) * 100
  return (premium / netCapital) * (365 / dte) * 100;
}

/**
 * Calculates the APR for a Covered Call strategy.
 * Formula: (Premium / Net Capital) * (365 / DTE) * 100
 * Net Capital = Current Price - Premium
 * 
 * @param premium The premium received for the call (per share)
 * @param currentPrice Current stock price
 * @param dte Days to Expiration
 * @returns Annualized percentage (e.g., 15.5)
 */
export function calculateCoveredCallAPR(premium: number, currentPrice: number, dte: number): number {
  if (currentPrice <= 0 || dte <= 0 || premium <= 0) return 0;
  
  // Use a floor for net capital
  const netCapital = Math.max(currentPrice - premium, currentPrice * 0.005);
  
  return (premium / netCapital) * (365 / dte) * 100;
}

/**
 * Calculates the APR for a general strategy based on profit and max risk.
 * 
 * @param profit Expected profit (absolute value)
 * @param maxRisk Maximum risk or capital required (absolute value)
 * @param dte Days to Expiration
 * @returns Annualized percentage (e.g., 15.5)
 */
export function calculateGeneralAPR(profit: number, maxRisk: number, dte: number): number {
  if (maxRisk <= 0 || dte <= 0) return 0;
  return (profit / maxRisk) * (365 / dte) * 100;
}
