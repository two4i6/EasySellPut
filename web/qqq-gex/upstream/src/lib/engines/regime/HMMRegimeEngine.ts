import { FactorEngine } from '../../FactorEngine';

export interface HMMResult {
  p_bull: number;    // Probability of Bull/Low-Risk state
  p_neutral: number; // Probability of Sideways/Mid-Risk state
  p_bear: number;    // Probability of Bear/High-Risk state
  logScore: number;
  state: 'BULL' | 'NEUTRAL' | 'BEAR';
}

/**
 * Hidden Markov Model Regime Engine
 *
 * Uses 3 hidden states to estimate market regime probabilities based on log returns.
 */
export class HMMRegimeEngine extends FactorEngine {
  // --- HMM Parameters (Default for SPX) ---
  // Transition Matrix A[i][j] = P(S_t = j | S_{t-1} = i)
  private A = [
    [0.98, 0.015, 0.005], // HIGH -> [HIGH, MID, LOW]
    [0.02, 0.95, 0.03],   // MID  -> [HIGH, MID, LOW]
    [0.01, 0.04, 0.95],   // LOW  -> [HIGH, MID, LOW]
  ];

  // Initial Probabilities pi
  private pi = [0.7, 0.2, 0.1];

  // Emission Parameters (Gaussian: [mean, std])
  private params = [
    [0.0005, 0.008], // HIGH: Positive mean, Low vol (Bull)
    [0.0, 0.015],    // MID:  Flat mean, Mid vol (Sideways)
    [-0.001, 0.03],  // LOW:  Negative mean, High vol (Bear)
  ];

  /** Calculate log returns from price series */
  public calculateLogReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) returns.push(Math.log(prices[i] / prices[i - 1]));
    return returns;
  }

  private gaussianPDF(x: number, mean: number, std: number): number {
    const variance = std * std;
    const exponent = -Math.pow(x - mean, 2) / (2 * variance);
    return (1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(exponent);
  }

  private studentTPDF(x: number, mean: number, std: number, df: number = 2): number {
    const z = (x - mean) / std;
    if (df === 1) return 1 / (Math.PI * std * (1 + z * z));
    if (df === 2) return 1 / (2 * std * Math.pow(1 + (z * z) / 2, 1.5));
    return this.gaussianPDF(x, mean, std);
  }

  /** Forward Algorithm for online inference. Returns probabilities for the LAST step. */
  public analyze(prices: number[], useStudentT: boolean = true): HMMResult {
    const returns = this.calculateLogReturns(prices);
    if (returns.length === 0) return { p_bear: 0.7, p_neutral: 0.2, p_bull: 0.1, logScore: 0, state: 'BEAR' };

    const nStates = this.pi.length;
    let alpha = [...this.pi];
    for (let j = 0; j < nStates; j++) alpha[j] *= useStudentT ? this.studentTPDF(returns[0], this.params[j][0], this.params[j][1]) : this.gaussianPDF(returns[0], this.params[j][0], this.params[j][1]);

    let sum = alpha.reduce((a, b) => a + b, 0);
    if (sum > 0) alpha = alpha.map(v => v / sum); else alpha = [...this.pi];
    let totalLogScore = Math.log(sum || 1e-10);

    for (let t = 1; t < returns.length; t++) {
      const nextAlpha = new Array(nStates).fill(0);
      for (let j = 0; j < nStates; j++) {
        let transitionProb = 0;
        for (let i = 0; i < nStates; i++) transitionProb += alpha[i] * this.A[i][j];
        const emission = useStudentT ? this.studentTPDF(returns[t], this.params[j][0], this.params[j][1]) : this.gaussianPDF(returns[t], this.params[j][0], this.params[j][1]);
        nextAlpha[j] = transitionProb * emission;
      }
      sum = nextAlpha.reduce((a, b) => a + b, 0);
      if (sum > 0) { alpha = nextAlpha.map(v => v / sum); totalLogScore += Math.log(sum); } else alpha = [...this.pi];
    }

    const [p_bull, p_neutral, p_bear] = alpha;
    const state = p_bear > p_bull && p_bear > p_neutral ? 'BEAR' : p_neutral > p_bull ? 'NEUTRAL' : 'BULL';
    return { p_bull, p_neutral, p_bear, logScore: totalLogScore / returns.length, state };
  }
}

export const hmmRegimeEngine = new HMMRegimeEngine();
