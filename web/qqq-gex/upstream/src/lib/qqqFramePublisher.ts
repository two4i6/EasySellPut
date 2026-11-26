/** Bounded latest-value publication. Raw quote/algorithm subscribers stay lossless. */
export function createQqqFramePublisher<T>(publish: (value: T) => void,
  schedule: (callback: () => void) => number, cancel: (id: number) => void) {
  let frame: number | undefined, pending: { value: T } | undefined, stopped = false;
  return {
    push(value: T) {
      if (stopped) return;
      pending = { value };
      if (frame !== undefined) return;
      frame = schedule(() => {
        frame = undefined;
        const next = pending; pending = undefined;
        if (!stopped && next) publish(next.value);
      });
    },
    stop() { stopped = true; pending = undefined; if (frame !== undefined) cancel(frame); frame = undefined; },
  };
}
