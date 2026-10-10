const CROCKFORD = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

export function generateRoomCode(random: () => number = Math.random): string {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CROCKFORD[Math.floor(random() * CROCKFORD.length)]
  }
  return code
}

export function isValidRoomCode(code: string): boolean {
  if (typeof code !== 'string' || code.length !== 6) return false
  for (const ch of code.toUpperCase()) {
    if (!CROCKFORD.includes(ch)) return false
  }
  return true
}

export function normalizeRoomCode(code: string): string {
  return (code ?? '').trim().toUpperCase()
}
