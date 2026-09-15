// A class list the presenter keeps and reuses. It stays on this computer and
// never reaches the database: nothing about it needs to, because the matching is
// only ever for display, and the report that needs the absent names is written
// in this same browser. A roster holds names and student numbers — the less of
// that travels, the better.
//
// This is not a gate. Whoever types a name that is not on the list still joins,
// under the name they typed; the person on the list simply reads as absent.

export type RosterEntry = {
  id: string
  name: string
  studentNo: string
  unit: string
}

export type ClassRoster = {
  id: string
  name: string
  updatedAt: string
  entries: RosterEntry[]
}

const ROSTER_KEY = 'interact:class-rosters'
const SESSION_ROSTER_PREFIX = 'interact:session-roster:'

// Deliberately no simplified-to-traditional conversion here, although the
// project carries a converter for captions. Personal names are the one place it
// is unsafe: 余/餘, 范/範, 沈/瀋, 于/於 and 台/臺 are all real surnames that a
// conversion will happily rewrite, which would break a match that worked or
// merge two people who are not the same person. A rare simplified list is a
// smaller problem than silently corrupting a name.

// Everything that separates two names that are the same name. Spaces are the
// obvious one — 王 小明 and 王小明 — but a list pasted out of Excel carries far
// worse: ideographic spaces, non-breaking spaces, zero-width joiners left by a
// copy, and three different interpuncts that all get used for the same break in
// an indigenous name.
const SEPARATORS = /[\s\u00a0\u3000\u200b-\u200d\ufeff\u30fb\u00b7\u2022\u2027\u2219\u22c5\uff65.]/g

export function normalizeName(value: string) {
  if (!value) return ''
  // NFKC first: it folds full-width Latin letters onto their ASCII forms, so a
  // student number typed on a Chinese IME matches one exported from a system
  // that used half-width.
  return value.normalize('NFKC').toLowerCase().replace(SEPARATORS, '')
}

// Student numbers are compared the same way. Full-width digits out of a Chinese
// IME are the usual difference, and NFKC folds those.
export function normalizeStudentNo(value: string) {
  return value ? value.normalize('NFKC').toLowerCase().replace(SEPARATORS, '') : ''
}

// Two people on the list who normalise to the same name. Neither can be told
// from the other by name alone, so the presenter is warned and the student
// number is what separates them.
export function duplicateNames(entries: RosterEntry[]) {
  const seen = new Map<string, number>()
  for (const entry of entries) {
    const key = normalizeName(entry.name)
    if (key) seen.set(key, (seen.get(key) || 0) + 1)
  }
  return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key))
}

function readRosters(): ClassRoster[] {
  try {
    const raw = window.localStorage.getItem(ROSTER_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed as ClassRoster[] : []
  } catch {
    // A corrupted store should not take the roster window down with it.
    return []
  }
}

function writeRosters(rosters: ClassRoster[]) {
  window.localStorage.setItem(ROSTER_KEY, JSON.stringify(rosters))
}

export function listRosters() {
  return readRosters().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getRoster(rosterId: string) {
  return readRosters().find((roster) => roster.id === rosterId) || null
}

export function saveRoster(roster: ClassRoster) {
  const rosters = readRosters()
  const index = rosters.findIndex((item) => item.id === roster.id)
  const saved = { ...roster, updatedAt: new Date().toISOString() }
  if (index >= 0) rosters[index] = saved
  else rosters.push(saved)
  writeRosters(rosters)
  return saved
}

export function deleteRoster(rosterId: string) {
  writeRosters(readRosters().filter((roster) => roster.id !== rosterId))
}

export function newRoster(name: string, entries: RosterEntry[] = []): ClassRoster {
  return { id: crypto.randomUUID(), name, updatedAt: new Date().toISOString(), entries }
}

export function newEntry(name = '', studentNo = '', unit = ''): RosterEntry {
  return { id: crypto.randomUUID(), name: name.trim(), studentNo: studentNo.trim(), unit: unit.trim() }
}

// Which roster this session is using. Per session rather than global, because a
// presenter runs several classes from the same computer.
export function getSessionRosterId(sessionId: string) {
  return window.localStorage.getItem(`${SESSION_ROSTER_PREFIX}${sessionId}`)
}

export function setSessionRosterId(sessionId: string, rosterId: string | null) {
  const key = `${SESSION_ROSTER_PREFIX}${sessionId}`
  if (rosterId) window.localStorage.setItem(key, rosterId)
  else window.localStorage.removeItem(key)
}

// One paste of a whole column of names, which is how a list arrives when there
// is no file to import — out of an email, a chat message, or a PDF. Newlines,
// commas, tabs and full-width commas all count as a break, because all four turn
// up depending on where it was copied from.
export function parsePastedNames(text: string) {
  return text
    .split(/[\n\r,、，\t;；]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => newEntry(name))
}

export type RosterMatch = {
  entry: RosterEntry
  // The participant who matched, or null when nobody by that name has joined.
  participantId: string | null
}

// Matching is a display concern, so it is redone from scratch on every render
// rather than stored. Nothing depends on a previous run, which means a late
// arrival simply lights up on the next pass.
export function matchRoster(
  entries: RosterEntry[],
  participants: Array<{ id: string; name: string }>,
) {
  const byName = new Map<string, string[]>()
  for (const participant of participants) {
    const key = normalizeName(participant.name)
    if (!key) continue
    const bucket = byName.get(key)
    if (bucket) bucket.push(participant.id)
    else byName.set(key, [participant.id])
  }

  const claimed = new Set<string>()
  const matches: RosterMatch[] = entries.map((entry) => {
    const bucket = byName.get(normalizeName(entry.name)) || []
    // One participant answers for at most one line on the list. Two students
    // called 陳怡君 who both joined get one line each rather than both lighting
    // up the first line and leaving the second looking absent.
    const participantId = bucket.find((id) => !claimed.has(id)) || null
    if (participantId) claimed.add(participantId)
    return { entry, participantId }
  })

  return { matches, matchedParticipantIds: claimed }
}
