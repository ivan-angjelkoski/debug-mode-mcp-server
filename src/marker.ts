export const MARKER_PREFIX = '__MCPDBG:'
export const MARKER_SUFFIX = '__'

export function buildMarker(sessionId: string): string {
  return `${MARKER_PREFIX}${sessionId}${MARKER_SUFFIX}`
}

export function isValidSessionIdForMarker(sessionId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(sessionId)
}
