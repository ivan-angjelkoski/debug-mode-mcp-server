import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SessionStore } from './session-store.ts'
import { registerSessionTools } from './tools/sessions.ts'
import { registerLogTools } from './tools/logs.ts'
import { registerInstrumentationTools } from './tools/instrumentation.ts'

export type McpServerOptions = {
  store: SessionStore
  logEndpoint: string
  defaultRoot: string
  name?: string
  version?: string
}

export function createMcpServer(opts: McpServerOptions): McpServer {
  const server = new McpServer({
    name: opts.name ?? 'debug-mcp-server',
    version: opts.version ?? '0.1.0',
  })
  registerSessionTools(server, opts.store, opts.logEndpoint)
  registerLogTools(server, opts.store)
  registerInstrumentationTools(server, opts.store, opts.defaultRoot)
  return server
}
