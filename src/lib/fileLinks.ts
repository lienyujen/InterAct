import { backendConfig } from './supabase'

// The base has to come from the resolved backend, not from import.meta.env: a
// student who joins through a link is talking to whatever project that link
// names, while the build-time value is whichever project happened to be
// configured when the page was built. When those differ the row is read from
// one project and the download is fetched from another, which Storage answers
// with a 404 NoSuchKey for a file that is perfectly intact.
export function publicFileUrl(storagePath: string) {
  const base = backendConfig?.url || ''
  return base ? `${base}/storage/v1/object/public/interact-files/${storagePath}` : ''
}

// Storage keys are ASCII-only, so without this a file called 講義.pdf would be
// saved as file.pdf. ?download makes Supabase send the real name back.
export function downloadHref(url: string, name: string) {
  return url ? `${url}?download=${encodeURIComponent(name)}` : ''
}
