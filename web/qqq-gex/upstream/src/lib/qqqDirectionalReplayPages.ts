type Key = { captured_at: string; expiry_date: string };

/** Seek from manifest keys, retaining the RPC's 128-row bound. Two independent
 * pages can overlap without OFFSET scans, duplicate rows or partial publication. */
export async function readQqqDirectionalReplayPages<T extends Key>(keys: readonly Key[], read: (after: Key | null, limit: number) => Promise<T[]>, signal: AbortSignal, cancel: () => void) {
  if (keys.length > 16_384 || keys.some((key, i) => !Number.isFinite(Date.parse(key.captured_at)) || i > 0 && (Date.parse(key.captured_at) < Date.parse(keys[i-1].captured_at) || Date.parse(key.captured_at) === Date.parse(keys[i-1].captured_at) && key.expiry_date <= keys[i-1].expiry_date))) throw Error('Invalid replay page index');
  const pages: T[][] = new Array(Math.ceil(keys.length / 128));
  let next = 0, failure: unknown;
  await Promise.all(Array.from({ length: Math.min(2, pages.length) }, async () => {
    while (!signal.aborted && next < pages.length) {
      const index = next++, offset = index * 128, expected = keys.slice(offset, offset + 128);
      try {
        const rows = await read(offset ? keys[offset-1] : null, expected.length);
        if (rows.length !== expected.length || rows.some((row, i) => Date.parse(row.captured_at) !== Date.parse(expected[i].captured_at) || row.expiry_date !== expected[i].expiry_date)) throw Error('Replay page changed during read');
        pages[index] = rows;
      } catch (error) { failure ??= error; cancel(); }
    }
  }));
  if (failure) throw failure;
  signal.throwIfAborted();
  return pages.flat();
}
