// Proves that a request comes from whoever owns this Supabase project.
//
// The publishable key is, by design, public — students hold it. That was fine
// while it only let you join a class, but creating one spends the project's own
// Gemini and OpenAI credits, so a machine the teacher no longer controls could
// keep teaching on their account. An owner key, held only by the teacher and
// replaceable at any time, is what separates the two.

// Absent on projects deployed before this existed. Those keep working exactly as
// they did — refusing every class on a project that was never given a key would
// break installs that are running fine.
export function ownerKeyConfigured() {
  return Boolean((Deno.env.get('INTERACT_OWNER_KEY') || '').trim())
}

// Compared in constant time: a comparison that returns early leaks how much of a
// guess was right, one character at a time.
function sameSecret(a: string, b: string) {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

export function isOwner(input: Record<string, unknown>) {
  const expected = (Deno.env.get('INTERACT_OWNER_KEY') || '').trim()
  if (!expected) return false
  const supplied = typeof input.ownerKey === 'string' ? input.ownerKey.trim() : ''
  if (!supplied) return false
  return sameSecret(supplied, expected)
}

// "Missing" and "wrong" call for completely different actions — paste the key,
// versus find out why the one you have is stale — so they must not share a
// message. Saying only that access was refused leaves the reader guessing.
export function ownerRefusalMessage(input: Record<string, unknown>) {
  const supplied = typeof input.ownerKey === 'string' ? input.ownerKey.trim() : ''
  if (!supplied) {
    return '這台電腦沒有這個 Supabase 專案的管理金鑰。請到系統設定貼上金鑰，或在你自己的電腦重新產生一組。'
  }
  return '這台電腦的管理金鑰與專案上的不符 —— 可能是在別台電腦重新產生過。請到系統設定貼上最新的那一組。'
}

export const ownerRequiredMessage = '這台電腦沒有這個 Supabase 專案的管理金鑰。請到系統設定貼上金鑰，或在你自己的電腦重新產生一組。'
