/** Proven OR-union subsumption. No market dates, P&L or threshold search. */
import {p6Rules} from './p6-e385-admission-v1';
export const P6_COMPACT_REMOVED_RULE_IDS=Object.freeze(['E611','E480','E507','E671','E585','E619','E334','E352'] as const);
const removed=new Set<string>(P6_COMPACT_REMOVED_RULE_IDS);
export const P6_COMPACT_RULES=Object.freeze(p6Rules.filter(([id])=>!removed.has(id)));
