import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function buildClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  if (url.includes('placeholder') || anonKey.includes('placeholder')) return null
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
}

export const supabase: SupabaseClient | null = buildClient()
