/** Complete profiles, including unknown future fields; no calculation projection. */
export function decodeQqqLatestSnapshotProfile(value: unknown): Record<string, unknown>[] {
  const packed = value as { version?: unknown; columns?: unknown; rows?: unknown };
  if (!packed || packed.version !== 1 || !Array.isArray(packed.columns) || !Array.isArray(packed.rows)
    || packed.columns.length > 52 || packed.columns.some(key => typeof key !== 'string')
    || new Set(packed.columns).size !== packed.columns.length) throw Error('Invalid latest profile transport');
  const columns = packed.columns as string[];
  return packed.rows.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== columns.length + 1 || !Number.isSafeInteger(row[0])
      || row[0] < 0 || row[0] >= 2 ** columns.length) throw Error('Invalid latest profile row');
    // Bitwise operators truncate masks above 31 fields. Division is exact for
    // the bounded integer masks used by this full-profile transport.
    return Object.fromEntries(columns.flatMap((key, index) => Math.floor(row[0] / 2 ** index) % 2 ? [[key, row[index + 1]]] : []));
  });
}
