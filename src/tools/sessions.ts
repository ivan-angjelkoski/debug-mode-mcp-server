import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SessionStore } from '../session-store.ts'

export function registerSessionTools(
  server: McpServer,
  store: SessionStore,
  logEndpoint: string,
): void {
  server.registerTool(
    'start_session',
    {
      title: 'Start debug session',
      description:
        'Start a new debug session. Returns a session_id, the marker string to embed on every instrumented line, and the HTTP log endpoint for the instrumented code to POST to. The agent should embed the marker as a trailing comment on every line it inserts so that remove_instrumentation can find them later.',
      inputSchema: {
        name: z.string().optional().describe('Optional human-readable label for the session.'),
      },
    },
    async (args) => {
      const session = store.createSession(args.name)
      const payload = {
        session_id: session.id,
        marker: session.marker,
        log_endpoint: logEndpoint,
        created_at: session.createdAt,
        examples: buildExamples(session.id, session.marker, logEndpoint),
        instructions: [
          `Every instrumented line MUST contain the marker '${session.marker}' as a comment.`,
          `Use the appropriate comment syntax for the language (// for JS/TS/Go/Rust, # for Python/shell/Ruby).`,
          `POST JSON to ${logEndpoint} with shape: { "session_id": "${session.id}", "label": "<tag>", "data": <anything> }`,
          `When done, call remove_instrumentation with this session_id, then end_session.`,
        ],
      }
      return jsonResult(payload)
    },
  )

  server.registerTool(
    'end_session',
    {
      title: 'End debug session',
      description:
        'Drop the session and all its buffered logs from memory. Does NOT remove instrumented lines from source files — call remove_instrumentation first.',
      inputSchema: {
        session_id: z.string().describe('Session id returned by start_session.'),
      },
    },
    async (args) => {
      const existed = store.endSession(args.session_id)
      return jsonResult({ ok: existed, session_id: args.session_id })
    },
  )

  server.registerTool(
    'list_sessions',
    {
      title: 'List active sessions',
      description: 'List all active debug sessions with their log counts.',
      inputSchema: {},
    },
    async () => {
      return jsonResult({ sessions: store.listSessions() })
    },
  )
}

function buildExamples(sessionId: string, marker: string, endpoint: string): Record<string, string> {
  return {
    typescript: `fetch('${endpoint}/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: '${sessionId}', label: 'my-label', data: { /* any JSON */ } }) }).catch(() => {}); // ${marker}`,
    python: `import urllib.request, json; urllib.request.urlopen(urllib.request.Request('${endpoint}/log', data=json.dumps({'session_id': '${sessionId}', 'label': 'my-label', 'data': {}}).encode(), headers={'Content-Type': 'application/json'}))  # ${marker}`,
    curl_shell: `curl -s -X POST ${endpoint}/log -H 'Content-Type: application/json' -d '{"session_id":"${sessionId}","label":"my-label","data":{}}' # ${marker}`,
    go: `http.Post("${endpoint}/log", "application/json", strings.NewReader(\`{"session_id":"${sessionId}","label":"my-label","data":{}}\`)) // ${marker}`,
  }
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  }
}
