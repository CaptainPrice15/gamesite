export interface PresenceMember {
  uid: string
  name: string
  ready: boolean
  started: boolean
}

function toMember(value: unknown): PresenceMember | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.uid !== 'string' || raw.uid === '') return null
  return {
    uid: raw.uid,
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : 'Player',
    ready: raw.ready === true,
    started: raw.started === true,
  }
}

export function flattenPresence(state: unknown): PresenceMember[] {
  if (typeof state !== 'object' || state === null) return []
  const out: PresenceMember[] = []
  const seen = new Set<string>()
  for (const bucket of Object.values(state as Record<string, unknown>)) {
    if (!Array.isArray(bucket)) continue
    for (const entry of bucket) {
      const member = toMember(entry)
      if (member && !seen.has(member.uid)) {
        seen.add(member.uid)
        out.push(member)
      }
    }
  }
  return out
}

export function pickOpponent(members: PresenceMember[], myUid: string): PresenceMember | null {
  return members.find((member) => member.uid !== myUid) ?? null
}
