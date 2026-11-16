/** Strategy-owned source declarations only. No admission, execution or data loading. */
import {freezeStrategyData} from '../strategy-module-v2';
export const E209_SOURCE_BOOKS = freezeStrategyData(['rolling-raw', 'rolling-base', 'e1-screen', 'c4-screen',
  'high-raw', 'high-e1', 'high-c4', 'low-raw', 'low-e1', 'low-c4'] as const);

export const E209_NATIVE_SOURCE_CONTRACT = freezeStrategyData({
  version: 'e209-source-initialization-native-v1', replayVariant: 'bass2_3_3',
  e1WarmupFullCalendarYears: 5, contextSource: 'high-raw',
} as const);
export function e209NativeSourcePolicy(id: typeof E209_SOURCE_BOOKS[number]) {
  return {replayVariant:E209_NATIVE_SOURCE_CONTRACT.replayVariant,
    fullCalendarYearsWarmup:id==='e1-screen'?E209_NATIVE_SOURCE_CONTRACT.e1WarmupFullCalendarYears:0,
    alignMonday:id==='e1-screen'||id==='c4-screen'};
}
