import { createClient } from '@supabase/supabase-js';
import {supabaseCachedFetch} from './supabaseCachedFetch';

export type SupabaseRuntimeConfig = {
  url: string;
  publishableKey: string;
};

export const resolveSupabaseRuntimeConfig = (
  env: Record<string, string | undefined> = process.env,
): SupabaseRuntimeConfig => ({
  // Prefer server-only names so the value is read when the container starts,
  // not frozen into the browser bundle during `next build`.
  url: env.SUPABASE_URL_SERVER || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost',
  publishableKey:
    env.SUPABASE_PUBLISHABLE_KEY
    || env.SUPABASE_ANON_KEY
    || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || 'key',
});

const { url: supabaseUrl, publishableKey: supabasePublishableKey } = resolveSupabaseRuntimeConfig();

// Publishable key respects RLS — api_cache 表需开放对应策略（见迁移 SQL）
export const supabaseAdmin = createClient(supabaseUrl, supabasePublishableKey, {
  global: {fetch:supabaseCachedFetch},
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});
