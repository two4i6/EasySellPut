/** Remember only acknowledged immutable writes. Failed writes remain retryable. */
export function createSuccessfulWriteCache(options: { maxEntries?: number; ttlMs?: number; now?: () => number } = {}) {
  const completed = new Map<string, number>();
  const pending = new Map<string, Promise<boolean>>();
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 24 * 60 * 60_000;
  const maxEntries = options.maxEntries ?? 8192;
  return async function writeRows<T>(rows: readonly T[], key: (row: T) => string, write: (rows: T[]) => Promise<boolean>) {
    for (const [id, expiresAt] of completed) if (expiresAt <= now()) completed.delete(id);
    const unique = new Map(rows.map(row => [key(row), row]));
    const waiting = new Set<Promise<boolean>>();
    const missing: T[] = [];
    for (const [id, row] of unique) {
      if (completed.has(id)) continue;
      const existing = pending.get(id);
      if (existing) waiting.add(existing); else missing.push(row);
    }
    if (missing.length) {
      const ids = missing.map(key);
      // Defer the writer until all pending row identities have been registered.
      const request = Promise.resolve().then(() => write(missing)).catch(() => false);
      for (const id of ids) pending.set(id, request);
      const finish = request.then(success => {
        if (success) {
          for (const id of ids) completed.set(id, now() + ttlMs);
          while (completed.size > maxEntries) completed.delete(completed.keys().next().value!);
        }
        return success;
      }).finally(() => { for (const id of ids) if (pending.get(id) === request) pending.delete(id); });
      waiting.add(finish);
    }
    return (await Promise.all(waiting)).every(Boolean);
  };
}
