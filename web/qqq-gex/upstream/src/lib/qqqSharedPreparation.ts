export type PreparationLease<T> = { promise: Promise<T>; release: () => void };

type Entry<T> = { promise: Promise<T>; controller: AbortController; users: number; complete: boolean };

/** Immutable frame/bar identities own results. Only active consumers own CPU work. */
export function createQqqSharedPreparation<I extends { frames: object; bars: object }, T>(
  keyOf: (input: I) => string,
  prepare: (input: I, signal: AbortSignal) => Promise<T>,
  maxCompleted = 8,
) {
  const cache = new WeakMap<object, WeakMap<object, Map<string, Entry<T>>>>();
  return (input: I): PreparationLease<T> => {
    let byBars = cache.get(input.frames);
    if (!byBars) { byBars = new WeakMap(); cache.set(input.frames, byBars); }
    let entries = byBars.get(input.bars);
    if (!entries) { entries = new Map(); byBars.set(input.bars, entries); }
    const key = keyOf(input), table = entries;
    const prune = () => {
      let completed = [...table.values()].filter(value => value.complete).length;
      for (const [candidate, value] of table) {
        if (completed <= maxCompleted) break;
        if (value.complete && value.users === 0) { table.delete(candidate); completed--; }
      }
    };
    let entry = table.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created: Entry<T> = {
        controller, users: 0, complete: false,
        promise: Promise.resolve().then(() => {
          if (!created.users) controller.abort();
          controller.signal.throwIfAborted();
          return prepare(input, controller.signal);
        }),
      };
      entry = created; table.set(key, created);
      void created.promise.then(() => {
        created.complete = true;
        if (controller.signal.aborted) { if (table.get(key) === created) table.delete(key); return; }
        prune();
      }, () => { if (table.get(key) === created) table.delete(key); });
    } else { table.delete(key); table.set(key, entry); }
    const owned = entry;
    owned.users++;
    let released = false;
    return { promise: owned.promise, release: () => {
      if (released) return;
      released = true; owned.users--;
      // StrictMode's immediate cleanup/remount can reacquire the same task.
      queueMicrotask(() => {
        if (owned.users) return;
        if (owned.complete) { prune(); return; }
        if (table.get(key) === owned) table.delete(key);
        owned.controller.abort();
      });
    } };
  };
}

/** Compatibility for non-Hook callers: keep ownership until completion. */
export function awaitQqqPreparation<T>(lease: PreparationLease<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    void lease.promise.then(lease.release, lease.release);
    return lease.promise;
  }
  if (signal.aborted) { lease.release(); return Promise.reject(signal.reason); }
  let onAbort: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([lease.promise, aborted]).finally(() => {
    signal.removeEventListener('abort', onAbort);
    lease.release();
  });
}
