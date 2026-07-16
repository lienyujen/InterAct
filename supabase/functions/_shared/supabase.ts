import { createClient } from 'npm:@supabase/supabase-js@2.110.1'

export function getAdminClient() {
  const projectUrl = Deno.env.get('SUPABASE_URL')
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  const legacyServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const secretKey = secretKeys ? JSON.parse(secretKeys).default : legacyServiceKey

  if (!projectUrl || !secretKey) {
    throw new Error('Supabase server credentials are unavailable.')
  }

  return createClient(projectUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function hashPresenterToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
