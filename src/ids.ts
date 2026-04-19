import { randomBytes } from 'node:crypto'

export function shortId(bytes = 3): string {
  return randomBytes(bytes).toString('hex')
}
