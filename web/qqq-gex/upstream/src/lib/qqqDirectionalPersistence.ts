type Row = { output?: { signalId?: unknown } };

/** Ignore-duplicate responses may contain no inserted row; verify the exact alert. */
export async function confirmQqqDirectionalWrite(signalId: string, inserted: unknown, readExisting: () => Promise<unknown>) {
  const contains = (rows: unknown) => Array.isArray(rows) && rows.some((row: Row) => row?.output?.signalId === signalId);
  return contains(inserted) || contains(await readExisting());
}
