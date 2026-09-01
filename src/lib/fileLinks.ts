export function publicFileUrl(storagePath: string) {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || ''
  return base ? `${base}/storage/v1/object/public/interact-files/${storagePath}` : ''
}

// Storage keys are ASCII-only, so without this a file called 講義.pdf would be
// saved as file.pdf. ?download makes Supabase send the real name back.
export function downloadHref(url: string, name: string) {
  return url ? `${url}?download=${encodeURIComponent(name)}` : ''
}
