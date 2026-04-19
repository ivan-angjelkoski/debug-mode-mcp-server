# debug-mcp-server

An MCP server that lets an AI agent (e.g. Claude) instrument your source code with temporary log statements, collect the resulting runtime data through an HTTP receiver, and then surgically remove every injected line when done.

## How it works

The server runs two transports simultaneously:

- **MCP over stdio** — the AI agent connects here and calls tools to manage sessions, read logs, and clean up instrumentation.
- **HTTP log receiver** (default `http://127.0.0.1:9323`) — instrumented code POSTs JSON log entries here at runtime.

### Workflow

1. Agent calls `start_session` → gets a `session_id`, a unique `marker` string, and the `log_endpoint`.
2. Agent inserts `fetch(log_endpoint + '/log', ...)` calls into the code under investigation, tagging every inserted line with the marker as a trailing comment.
3. You run the code; log entries accumulate in memory.
4. Agent calls `get_logs` / `log_stats` to inspect the data.
5. Agent calls `remove_instrumentation` to delete every marked line from the source tree.
6. Agent calls `end_session` to free memory.

## MCP tools

| Tool | Description |
|------|-------------|
| `start_session` | Create a session. Returns `session_id`, `marker`, `log_endpoint`, and ready-to-paste code examples for JS/TS, Python, shell, and Go. |
| `end_session` | Drop session and all buffered logs. Call after `remove_instrumentation`. |
| `list_sessions` | List active sessions with log counts. |
| `get_logs` | Read buffered logs. Supports `limit`, `offset`, `since_id`, `label` (exact match), and `contains` (substring) filters. |
| `clear_logs` | Flush buffered logs for a session. Useful between reproduction attempts. |
| `log_stats` | Per-session summary: total logged, buffered count, timestamps, counts by label. |
| `find_instrumentation` | Scan the source tree for lines containing the session marker. Read-only preview. |
| `remove_instrumentation` | Delete every line containing the session marker. Supports `dry_run=true` to preview first. Skips `node_modules`, `.git`, `dist`, `build`, `.next`, and similar directories. |

## HTTP API

### `POST /log`

Submit a log entry from instrumented code.

```json
{
  "session_id": "<session id>",
  "label": "my-tag",
  "data": { "anything": "json" },
  "source": { "file": "src/foo.ts", "line": 42 }
}
```

Returns `{ "ok": true, "id": <entry id> }`.

### `GET /health`

Returns `{ "ok": true, "port": 9323, "sessions": <count> }`.

## Installation

```bash
pnpm install
pnpm build
```

## Usage

### Run directly

```bash
node dist/index.mjs
```

### Add to Claude Code (`~/.claude/claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "debug-mode": {
      "command": "node",
      "args": ["/absolute/path/to/debug-mcp-server/dist/index.mjs"]
    }
  }
}
```

### Development (watch mode)

```bash
pnpm dev
```

### Smoke test

```bash
pnpm build && node smoke.mjs
```

## Configuration

All settings are controlled via environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG_MCP_PORT` | `9323` | HTTP log receiver port |
| `DEBUG_MCP_HOST` | `127.0.0.1` | HTTP log receiver host |
| `DEBUG_MCP_MAX_LOGS_PER_SESSION` | `5000` | Per-session in-memory log buffer cap (oldest entries are dropped when exceeded) |
| `DEBUG_MCP_MAX_PAYLOAD_BYTES` | `1048576` | Max request body size for `POST /log` (1 MB) |
| `DEBUG_MCP_ROOT` | `process.cwd()` | Default directory for instrumentation scans |

## Requirements

- Node.js ≥ 20
