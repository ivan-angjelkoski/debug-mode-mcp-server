# Debug MCP

Use the `debug-mode` MCP server to instrument code, collect runtime logs, and clean up — without leaving any trace behind.

## When to use this

When you need to understand runtime behavior that's hard to infer from static analysis: what values flow through a function, which branch is taken, what a promise resolves to, etc.

## Standard workflow

### 1. Start a session

Call `start_session` (optionally pass a `name` label).

It returns:
- `session_id` — pass this to every subsequent tool call
- `marker` — a unique string like `__MCPDBG:abc123__` that must appear as a trailing comment on **every line you insert**
- `log_endpoint` — the HTTP URL to POST logs to (e.g. `http://127.0.0.1:9323`)
- `examples` — ready-to-paste snippets for JS/TS, Python, shell, and Go

### 2. Instrument the code

Insert fire-and-forget log calls at the points of interest. Tag **every inserted line** with the marker as a trailing comment — this is how `remove_instrumentation` finds them later.

TypeScript/JavaScript example:
```ts
fetch(`${LOG_ENDPOINT}/log`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ session_id: SESSION_ID, label: 'my-label', data: { value, ctx } }),
}).catch(() => {}); // __MCPDBG:abc123__
```

Rules:
- Use `// marker` for JS/TS/Go/Rust, `# marker` for Python/shell/Ruby
- Keep the fetch/post non-blocking (`.catch(() => {})` or equivalent) so it never affects program flow
- Use descriptive `label` values — you'll filter by them in `get_logs`
- The `data` field accepts any JSON

### 3. Run the code

Execute the code under investigation normally. Logs accumulate in the server's in-memory buffer (up to 5 000 entries per session by default; oldest are dropped if exceeded).

### 4. Read the logs

- `get_logs` — paginated log reader. Filter by `label` (exact), `contains` (substring across label + data), `since_id`, `offset`, `limit`.
- `log_stats` — quick summary: total logged, buffer size, timestamps, counts per label.
- `clear_logs` — flush the buffer between reproduction attempts without ending the session.

### 5. Clean up instrumentation

Before ending the session, remove every injected line:

1. Call `find_instrumentation` (optional) to preview what will be removed.
2. Call `remove_instrumentation` with `dry_run: true` to confirm the hit list.
3. Call `remove_instrumentation` with `dry_run: false` to delete the lines for real.

The tool skips `node_modules`, `.git`, `dist`, `build`, `.next`, and similar directories. Pass `root` to target a specific subtree.

### 6. End the session

Call `end_session` to free the in-memory session and logs.

## Tool reference

| Tool | Key inputs | Purpose |
|------|-----------|---------|
| `start_session` | `name?` | Create session; get marker + endpoint |
| `end_session` | `session_id` | Free session memory |
| `list_sessions` | — | See all active sessions |
| `get_logs` | `session_id`, `label?`, `contains?`, `since_id?`, `limit?`, `offset?` | Read buffered logs |
| `clear_logs` | `session_id` | Flush logs without ending session |
| `log_stats` | `session_id` | Counts by label, timestamps |
| `find_instrumentation` | `session_id`, `root?` | Scan for marked lines (read-only) |
| `remove_instrumentation` | `session_id`, `root?`, `dry_run?` | Delete marked lines |

## Important rules

- **Always tag every inserted line** with the marker comment — missing even one line means `remove_instrumentation` won't clean it up.
- **Always call `remove_instrumentation` before `end_session`** — ending the session first loses the marker, making cleanup impossible.
- **Use `dry_run: true` before committing** the real remove, especially in large codebases.
- Logs are in-memory only — they don't survive a server restart.
