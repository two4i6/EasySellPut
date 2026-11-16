export type QqqCompositeCycle<Layer extends string> = {
  layer: Layer;
  signalDate: string;
  openDate: string;
  expiry: string;
};

export type QqqCompositeDecision<Layer extends string, Cycle extends QqqCompositeCycle<Layer>> = Cycle & {
  selectedLayer: Layer | null;
  preemptedLayer: Layer | null;
  accepted: boolean;
};

export type QqqCompositeCoordinationResult<Layer extends string, Cycle extends QqqCompositeCycle<Layer>> = {
  accepted: Cycle[];
  all: QqqCompositeDecision<Layer, Cycle>[];
  preempted: Record<Layer, number>;
};

/**
 * Coordinates candidate cycles by their actual openDate. The implementation
 * knows nothing about strategy rules, P&L, or dates admitted by research;
 * those remain inside each layer Adapter.
 */
export function coordinateQqqCompositeCandidates<Layer extends string, Cycle extends QqqCompositeCycle<Layer>>(
  cycles: readonly Cycle[],
  priority: readonly Layer[],
): QqqCompositeCoordinationResult<Layer, Cycle> {
  const byOpenDate = new Map<string, Cycle[]>();
  for (const cycle of cycles) byOpenDate.set(cycle.openDate, [...(byOpenDate.get(cycle.openDate) ?? []), cycle]);

  const accepted: Cycle[] = [];
  const preempted = Object.fromEntries(priority.map(layer => [layer, 0])) as Record<Layer, number>;
  const all: QqqCompositeDecision<Layer, Cycle>[] = [];
  const priorityIndex = (layer: Layer) => priority.indexOf(layer);

  for (const candidates of byOpenDate.values()) {
    const ordered = [...candidates].sort((left, right) => priorityIndex(left.layer) - priorityIndex(right.layer) || left.signalDate.localeCompare(right.signalDate));
    const winner = ordered[0];
    if (!winner) continue;
    accepted.push(winner);
    all.push({ ...winner, selectedLayer: winner.layer, preemptedLayer: null, accepted: true });
    for (const loser of ordered.slice(1)) {
      preempted[loser.layer] += 1;
      all.push({ ...loser, selectedLayer: winner.layer, preemptedLayer: loser.layer, accepted: false });
    }
  }

  const sort = (left: QqqCompositeCycle<Layer>, right: QqqCompositeCycle<Layer>) => `${left.openDate}|${left.signalDate}|${left.layer}`.localeCompare(`${right.openDate}|${right.signalDate}|${right.layer}`);
  return { accepted: accepted.sort(sort), all: all.sort(sort), preempted };
}
