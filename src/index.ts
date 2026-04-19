import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { startHttpServer } from './http-server.ts'
import { createMcpServer } from './mcp-server.ts'
import { SessionStore } from './session-store.ts'

const DEFAULT_PORT = 9323
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_MAX_LOGS = 5000
const DEFAULT_MAX_PAYLOAD = 1024 * 1024

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid ${name}: "${raw}" (expected positive integer)`)
  }
  return n
}

async function main(): Promise<void> {
  const port = parseIntEnv('DEBUG_MCP_PORT', DEFAULT_PORT)
  const host = process.env.DEBUG_MCP_HOST ?? DEFAULT_HOST
  const maxLogs = parseIntEnv('DEBUG_MCP_MAX_LOGS_PER_SESSION', DEFAULT_MAX_LOGS)
  const maxPayload = parseIntEnv('DEBUG_MCP_MAX_PAYLOAD_BYTES', DEFAULT_MAX_PAYLOAD)
  const defaultRoot = process.env.DEBUG_MCP_ROOT ?? process.cwd()

  const store = new SessionStore(maxLogs)

  const http = await startHttpServer(store, {
    host,
    port,
    maxPayloadBytes: maxPayload,
    logger: (msg) => process.stderr.write(`${msg}\n`),
  })

  const mcp = createMcpServer({
    store,
    logEndpoint: http.url,
    defaultRoot,
  })

  const transport = new StdioServerTransport()
  await mcp.connect(transport)

  process.stderr.write(
    `[debug-mcp] ready — MCP (stdio) + HTTP log receiver on ${http.url} (root=${defaultRoot})\n`,
  )

  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`[debug-mcp] received ${signal}, shutting down\n`)
    try {
      await mcp.close()
    } catch {}
    try {
      await http.close()
    } catch {}
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  process.stderr.write(`[debug-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
  process.exit(1)
})
