import { shortId } from './ids.ts'
import { buildMarker } from './marker.ts'

export type LogEntry = {
  id: number
  ts: string
  label?: string
  data: unknown
  source?: { file?: string; line?: number }
  client?: { ip?: string; userAgent?: string }
}

export type Session = {
  id: string
  name?: string
  createdAt: string
  marker: string
  logs: LogEntry[]
  logCount: number
  nextLogId: number
}

export type SessionSummary = {
  id: string
  name?: string
  createdAt: string
  marker: string
  logCount: number
  bufferedCount: number
}

export type AppendLogInput = {
  label?: string
  data: unknown
  source?: { file?: string; line?: number }
  client?: { ip?: string; userAgent?: string }
}

export type GetLogsOptions = {
  limit?: number
  offset?: number
  sinceId?: number
  label?: string
  contains?: string
}

export type GetLogsResult = {
  logs: LogEntry[]
  totalMatched: number
  bufferedCount: number
  totalEverLogged: number
  truncated: boolean
}

export class SessionNotFoundError extends Error {
  constructor(public sessionId: string) {
    super(`session not found: ${sessionId}`)
    this.name = 'SessionNotFoundError'
  }
}

export class SessionStore {
  private sessions = new Map<string, Session>()

  constructor(private readonly maxLogsPerSession: number) {
    if (maxLogsPerSession < 1) throw new Error('maxLogsPerSession must be >= 1')
  }

  createSession(name?: string): Session {
    let id = shortId()
    while (this.sessions.has(id)) id = shortId()
    const session: Session = {
      id,
      name,
      createdAt: new Date().toISOString(),
      marker: buildMarker(id),
      logs: [],
      logCount: 0,
      nextLogId: 1,
    }
    this.sessions.set(id, session)
    return session
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getSession(sessionId: string): Session {
    const s = this.sessions.get(sessionId)
    if (!s) throw new SessionNotFoundError(sessionId)
    return s
  }

  listSessions(): SessionSummary[] {
    return [...this.sessions.values()].map(this.summarize)
  }

  summarize(s: Session): SessionSummary {
    return {
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      marker: s.marker,
      logCount: s.logCount,
      bufferedCount: s.logs.length,
    }
  }

  endSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId)
  }

  count(): number {
    return this.sessions.size
  }

  appendLog(sessionId: string, input: AppendLogInput): LogEntry {
    const s = this.getSession(sessionId)
    const entry: LogEntry = {
      id: s.nextLogId++,
      ts: new Date().toISOString(),
      label: input.label,
      data: input.data,
      source: input.source,
      client: input.client,
    }
    s.logs.push(entry)
    s.logCount++
    if (s.logs.length > this.maxLogsPerSession) {
      s.logs.splice(0, s.logs.length - this.maxLogsPerSession)
    }
    return entry
  }

  clearLogs(sessionId: string): number {
    const s = this.getSession(sessionId)
    const cleared = s.logs.length
    s.logs = []
    return cleared
  }

  getLogs(sessionId: string, opts: GetLogsOptions = {}): GetLogsResult {
    const s = this.getSession(sessionId)
    const filtered = s.logs.filter((entry) => {
      if (opts.sinceId !== undefined && entry.id <= opts.sinceId) return false
      if (opts.label !== undefined && entry.label !== opts.label) return false
      if (opts.contains !== undefined) {
        const needle = opts.contains
        const hay = safeStringify(entry.data) + ' ' + (entry.label ?? '')
        if (!hay.includes(needle)) return false
      }
      return true
    })
    const totalMatched = filtered.length
    const offset = opts.offset ?? 0
    const limit = opts.limit ?? 200
    const logs = filtered.slice(offset, offset + limit)
    return {
      logs,
      totalMatched,
      bufferedCount: s.logs.length,
      totalEverLogged: s.logCount,
      truncated: s.logCount > s.logs.length,
    }
  }

  logStats(sessionId: string): {
    total: number
    bufferedCount: number
    firstTs?: string
    lastTs?: string
    byLabel: Record<string, number>
  } {
    const s = this.getSession(sessionId)
    const byLabel: Record<string, number> = {}
    for (const e of s.logs) {
      const k = e.label ?? '(unlabeled)'
      byLabel[k] = (byLabel[k] ?? 0) + 1
    }
    return {
      total: s.logCount,
      bufferedCount: s.logs.length,
      firstTs: s.logs[0]?.ts,
      lastTs: s.logs.at(-1)?.ts,
      byLabel,
    }
  }
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}
