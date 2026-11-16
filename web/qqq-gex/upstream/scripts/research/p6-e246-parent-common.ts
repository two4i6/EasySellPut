/** P6.E246: simplified exact-ledger parent; all six E109 leaves are dead under E104. */
import { isQqqP4E68MergedCurrentBarReject, isQqqP4E104RecoveryCurrentBar } from '../../src/lib/engines/analysis/QqqP4DynamicReplay';
import { f, type Row } from './p4-e370-research-common';
import { p6e84BullQualityVeto } from './p6-e84-parent-common';
import { p6e106RangePressure } from './p6-e106-parent-common';
import { p6e122PositiveGuard } from './p6-e132-parent-common';
import { p6e222Options, p6e222RangeFloor } from './p6-e222-parent-common';
export const p6e246UnifiedReject=(row:Row)=>(isQqqP4E68MergedCurrentBarReject(row)&&!isQqqP4E104RecoveryCurrentBar(row))
 ||p6e84BullQualityVeto(row)||p6e106RangePressure(row)||p6e122PositiveGuard(row)
 ||(f(row.market.roc5)<0&&f(row.market.range20dPct)>=p6e222RangeFloor&&f(row.market.vix)<=22.25);
export const p6e246Options={...p6e222Options,additionalReject:p6e246UnifiedReject};
