import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SessionStore } from '../session-store.ts'
import { findMarkerHits, removeMarkerHits } from '../instrumentation-scan.ts'

export function registerInstrumentationTools(
  server: McpServer,
  store: SessionStore,
  defaultRoot: string,
): void {
  server.registerTool(
    'find_instrumentation',
    {
      title: 'Find instrumented lines',
      description:
        "Scan the project for lines containing this session's marker. Read-only; use before remove_instrumentation to preview.",
      inputSchema: {
        session_id: z.string(),
        root: z.string().optional().describe(`Directory to scan. Defaults to the server's working directory (${defaultRoot}).`),
      },
    },
    async (args) => {
      const session = store.getSession(args.session_id)
      const root = args.root ?? defaultRoot
      const hits = await findMarkerHits(root, session.marker)
      return jsonResult({ root, marker: session.marker, count: hits.length, hits })
    },
  )

  server.registerTool(
    'remove_instrumentation',
    {
      title: 'Remove instrumented lines',
      description:
        "Delete every line containing this session's marker. Set dry_run=true first to preview. Works on any text file; skips node_modules, .git, dist, build, .next, and similar directories.",
      inputSchema: {
        session_id: z.string(),
        root: z.string().optional().describe(`Directory to scan. Defaults to the server's working directory (${defaultRoot}).`),
        dry_run: z.boolean().optional().describe('If true, report what would be removed without writing.'),
      },
    },
    async (args) => {
      const session = store.getSession(args.session_id)
      const root = args.root ?? defaultRoot
      const result = await removeMarkerHits(root, session.marker, args.dry_run ?? false)
      return jsonResult({ root, marker: session.marker, ...result })
    },
  )
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  }
}
