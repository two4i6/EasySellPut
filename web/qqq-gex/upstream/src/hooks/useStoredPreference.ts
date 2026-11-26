'use client';
import { useEffect, useState } from 'react';

/** Stable key/parser/default supplied by each mode; storage failure is optional. */
export function useStoredPreference<T>(key: string, defaults: T, parse: (raw: string | null) => T) {
  const [value, setValue] = useState(defaults);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    try { setValue(parse(localStorage.getItem(key))); }
    catch { setValue(defaults); }
    setReadyKey(key);
  }, [key, defaults, parse]);
  useEffect(() => {
    if (readyKey !== key) return;
    try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); }
    catch { /* Controls remain usable without persistence. */ }
  }, [key, readyKey, value]);
  return [value, setValue, readyKey === key] as const;
}
