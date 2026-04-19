import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { SessionStore } from './session-store.ts'

export type HttpServerOptions = {
  host: string
  port: number
  maxPayloadBytes: number
  logger?: (msg: string) => void
}

export type HttpServerHandle = {
  server: Server
  url: string
  close: () => Promise<void>
}

export async function startHttpServer(
  store: SessionStore,
  opts: HttpServerOptions,
): Promise<HttpServerHandle> {
  const log = opts.logger ?? (() => {})

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, store, opts)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`[http] unhandled error: ${msg}`)
      if (!res.headersSent) writeJson(res, 500, { ok: false, error: 'internal error' })
      else res.end()
    }
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListen)
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`port ${opts.port} already in use on ${opts.host}`)
          : err,
      )
    }
    const onListen = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListen)
    server.listen(opts.port, opts.host)
  })

  const url = `http://${opts.host}:${opts.port}`
  return {
    server,
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  store: SessionStore,
  opts: HttpServerOptions,
): Promise<void> {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (req.method === 'GET' && url.pathname === '/health') {
    writeJson(res, 200, { ok: true, port: opts.port, sessions: store.count() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/log') {
    await handleLog(req, res, store, opts)
    return
  }

  writeJson(res, 404, { ok: false, error: 'not found' })
}

async function handleLog(
  req: IncomingMessage,
  res: ServerResponse,
  store: SessionStore,
  opts: HttpServerOptions,
): Promise<void> {
  let body: string
  try {
    body = await readBody(req, opts.maxPayloadBytes)
  } catch (err) {
    const code = err instanceof PayloadTooLargeError ? 413 : 400
    writeJson(res, code, { ok: false, error: err instanceof Error ? err.message : 'bad request' })
    return
  }

  let parsed: unknown
  try {
    parsed = body.length ? JSON.parse(body) : {}
  } catch {
    writeJson(res, 400, { ok: false, error: 'invalid json' })
    return
  }

  if (!isRecord(parsed)) {
    writeJson(res, 400, { ok: false, error: 'body must be a JSON object' })
    return
  }

  const sessionId = parsed.session_id
  if (typeof sessionId !== 'string' || !sessionId) {
    writeJson(res, 400, { ok: false, error: 'session_id (string) is required' })
    return
  }

  if (!store.hasSession(sessionId)) {
    writeJson(res, 404, { ok: false, error: `unknown session_id: ${sessionId}` })
    return
  }

  const label = typeof parsed.label === 'string' ? parsed.label : undefined
  const source = isRecord(parsed.source)
    ? {
        file: typeof parsed.source.file === 'string' ? parsed.source.file : undefined,
        line: typeof parsed.source.line === 'number' ? parsed.source.line : undefined,
      }
    : undefined

  const entry = store.appendLog(sessionId, {
    label,
    data: parsed.data,
    source,
    client: {
      ip: clientIp(req),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    },
  })

  writeJson(res, 200, { ok: true, id: entry.id })
}

class PayloadTooLargeError extends Error {
  constructor(limit: number) {
    super(`payload exceeds ${limit} bytes`)
    this.name = 'PayloadTooLargeError'
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        req.destroy()
        reject(new PayloadTooLargeError(limit))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(payload).toString())
  res.end(payload)
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '600')
}

function clientIp(req: IncomingMessage): string | undefined {
  return req.socket.remoteAddress ?? undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
