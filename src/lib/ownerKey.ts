// The teacher's proof that this machine may run classes on their project.
//
// Kept apart from the backend configuration because the two have different
// lifetimes: the project reference and publishable key are settings, while this
// is a credential that gets replaced the moment a machine falls out of trust.
const STORAGE_KEY = 'interact:owner-key'

export function getOwnerKey() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveOwnerKey(key: string) {
  try {
    const trimmed = key.trim()
    if (trimmed) window.localStorage.setItem(STORAGE_KEY, trimmed)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // A locked-down profile still works for this session.
  }
}

export function hasOwnerKey() {
  return getOwnerKey().length > 0
}

// 256 bits from the platform generator. Long enough that guessing is not a
// consideration, and grouped so it can be read aloud or retyped without error.
export function generateOwnerKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
  return (body.match(/.{1,6}/g) || []).join('-')
}

// Every presenter call carries it, so a machine without the key can neither
// start a class nor touch one that is already running.
export function withOwnerKey<T extends Record<string, unknown>>(body: T) {
  const ownerKey = getOwnerKey()
  return ownerKey ? { ...body, ownerKey } : body
}
