/** Common bounded replay request; dates select samples, never admission. */
import {SPREAD_EXECUTION_PROFILES,type SpreadExecutionProfile} from './spread-execution-profile-names-v4';
export const STANDALONE_RESEARCH_FIXTURES = ['market-2026-10-23-15y-vxn','market-2026-10-29-15y-vxn'] as const;
export type ResearchReplayRequest = { fixture: import('../engines/leveraged-overlay/v2/backtest/run-spec').RegisteredFixtureId; startDate: string; endDate: string; executionProfile?: SpreadExecutionProfile };
export function parseResearchReplayRequest(raw: unknown): ResearchReplayRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected research request object');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(k => !['fixture', 'startDate', 'endDate', 'executionProfile'].includes(k))) throw new Error('Unknown research request field');
  if (value.executionProfile !== undefined && !SPREAD_EXECUTION_PROFILES.includes(value.executionProfile as SpreadExecutionProfile)) throw new Error('Unknown execution profile');
  const fixture = value.fixture ?? 'market-2026-10-29-15y-vxn';
  if (!(STANDALONE_RESEARCH_FIXTURES as readonly string[]).includes(fixture as string)) throw new Error('Unsupported full fixture');
  const startDate = value.startDate ?? (fixture==='market-2026-10-29-15y-vxn'?'2011-10-29':'2011-10-23'), endDate = value.endDate ?? (fixture==='market-2026-10-29-15y-vxn'?'2026-10-29':'2026-10-23');
  for (const date of [startDate, endDate]) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
      || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid replay date');
  }
  if (String(startDate) > String(endDate)) throw new Error('Reversed replay window');
  return { fixture: fixture as ResearchReplayRequest['fixture'], startDate: String(startDate), endDate: String(endDate),
    ...(value.executionProfile === undefined ? {} : { executionProfile: value.executionProfile as SpreadExecutionProfile }) };
}

