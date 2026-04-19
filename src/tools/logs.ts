import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SessionStore } from '../session-store.ts'

export function registerLogTools(server: McpServer, store: SessionStore): void {
  server.registerTool(
    'get_logs',
    {
      title: 'Read logs',
      description:
        'Read buffered logs for a session. Supports basic filtering and pagination. If truncated is true, older logs were dropped due to the per-session buffer cap.',
      inputSchema: {
        session_id: z.string(),
        limit: z.number().int().positive().max(2000).optional().describe('Max entries to return (default 200).'),
        offset: z.number().int().nonnegative().optional(),
        since_id: z.number().int().nonnegative().optional().describe('Only return entries with id > since_id.'),
        label: z.string().optional().describe('Exact-match filter on label.'),
        contains: z.string().optional().describe('Substring filter across stringified data and label.'),
      },
    },
    async (args) => {
      const result = store.getLogs(args.session_id, {
        limit: args.limit,
        offset: args.offset,
        sinceId: args.since_id,
        label: args.label,
        contains: args.contains,
      })
      return jsonResult(result)
    },
  )

  server.registerTool(
    'clear_logs',
    {
      title: 'Clear logs',
      description: 'Drop all buffered logs for a session. Use between reproduction attempts.',
      inputSchema: {
        session_id: z.string(),
      },
    },
    async (args) => {
      const cleared = store.clearLogs(args.session_id)
      return jsonResult({ cleared })
    },
  )

  server.registerTool(
    'log_stats',
    {
      title: 'Log statistics',
      description: 'Summary counts for a session: total logged, currently buffered, timestamps, and counts by label.',
      inputSchema: {
        session_id: z.string(),
      },
    },
    async (args) => {
      return jsonResult(store.logStats(args.session_id))
    },
  )
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  }
}
