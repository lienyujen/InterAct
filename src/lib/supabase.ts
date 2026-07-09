import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      realtime: { params: { eventsPerSecond: 20 } },
    })
  : null

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase 尚未設定。請建立 .env 並填入 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY。')
  }

  return supabase
}
