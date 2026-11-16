import type { StrategyParams } from '../../types/params';

type ConfiguredMode = NonNullable<StrategyParams['pcsRescueFillFallbackPairSearchMode']>;

export function resolvePcsFillFallbackPairSearchMode(input: {
  configuredMode?: ConfiguredMode;
  quoteOnlyWidth?: boolean;
  regime: string;
  slowSubregime?: string;
  rv20?: number;
  quoteOnlyBullSr01Rv20Min?: number;
  quoteOnlyBullSr01Rv20Max?: number;
}): ConfiguredMode | undefined {
  const mode = input.configuredMode ?? (input.quoteOnlyWidth === true ? 'quote_only_width_v1' : undefined);
  if (mode !== 'quote_only_width_v1') return mode;

  const constrainedQuoteOnlyState = input.regime === 'BULL' && input.slowSubregime === 'SR01';
  const belowQuoteOnlyMinimum = Number.isFinite(input.quoteOnlyBullSr01Rv20Min)
    && (input.rv20 ?? Number.NEGATIVE_INFINITY) < input.quoteOnlyBullSr01Rv20Min!;
  const atOrAboveQuoteOnlyMaximum = Number.isFinite(input.quoteOnlyBullSr01Rv20Max)
    && (input.rv20 ?? Number.POSITIVE_INFINITY) >= input.quoteOnlyBullSr01Rv20Max!;
  return constrainedQuoteOnlyState && (belowQuoteOnlyMinimum || atOrAboveQuoteOnlyMaximum) ? undefined : mode;
}
