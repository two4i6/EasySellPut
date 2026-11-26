const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const partsFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const qqqEasternDateKey = (value: string | number | Date) => dateFormatter.format(new Date(value));

export function qqqEasternMidnightUtc(date: string): Date {
  const target = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date) throw new Error('Invalid session date');
  let utc = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(partsFormatter.formatToParts(new Date(utc)).map(p => [p.type, p.value]));
    utc += target - Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  }
  return new Date(utc);
}

/** Calendar day boundaries, including 23/25-hour DST days; not market hours. */
export function qqqMarketDateBounds(date: string) {
  const from = qqqEasternMidnightUtc(date).toISOString();
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { from, to: qqqEasternMidnightUtc(next.toISOString().slice(0, 10)).toISOString() };
}
