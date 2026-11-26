/** Keep only the latest layout write in each paint frame; flush before saving a drag. */
export function createQqqLayoutFrame(
  request: (callback: FrameRequestCallback) => number = callback => requestAnimationFrame(callback),
  cancel: (id: number) => void = id => cancelAnimationFrame(id),
) {
  let frame: number | null = null;
  let pending: (() => void) | null = null;
  const run = () => {
    frame = null;
    const task = pending;
    pending = null;
    task?.();
  };
  return {
    schedule(task: () => void) {
      pending = task;
      if (frame === null) frame = request(run);
    },
    flush() {
      if (frame !== null) cancel(frame);
      run();
    },
    cancel() {
      if (frame !== null) cancel(frame);
      frame = null;
      pending = null;
    },
  };
}
