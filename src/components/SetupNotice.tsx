import { isSupabaseConfigured } from '../lib/supabase'

export function SetupNotice() {
  if (isSupabaseConfigured) return null

  return (
    <div className="notice">
      <strong>尚未連接 Supabase。</strong>
      <span>請建立 `.env`，填入 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`，並執行 `supabase/schema.sql`。</span>
    </div>
  )
}
