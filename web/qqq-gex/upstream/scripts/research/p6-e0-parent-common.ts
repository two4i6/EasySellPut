/** P6.E0 research parent: exact alias of the promoted P5.E213 compact PCS parent. */
import { p5e213CompactParent, p5e213Options } from './p5-e213-semantic-compact-parent-common';

/** P6.E0 starts from P5.E213; keep one rule implementation to prevent lineage drift. */
export const p6e0Parent = p5e213CompactParent;
export const p6e0Options = p5e213Options;
