export interface UnifiedScore<TTag extends string = string> {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' | string;
  flags: Record<string, boolean>;
  confidence: number;
  tags: TTag[];
}
