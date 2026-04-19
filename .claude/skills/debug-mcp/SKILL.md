---
name: debug-mcp
description: "Debug runtime behavior by starting a local HTTP log receiver, instrumenting code with temporary log statements tagged with a unique marker, collecting logs, and surgically removing all inserted lines when done — works for browser frontends, Node.js, Python, Go, or anything that can make HTTP requests"
allowed-tools: [Bash, Edit, Grep, Glob]
---

# Debug MCP Skill

Instrument code with temporary log statements, collect runtime data via a local HTTP server (logs stored in memory), and remove every injected line when done — leaving no trace.

The log receiver lives at `${CLAUDE_SKILL_DIR}/scripts/server.js`. No installation needed.

---

## Phase 1 — Start the server

Check if the server is already running; start it if not:

```bash
curl -s http://127.0.0.1:9323/health 2>/dev/null || (node ${CLAUDE_SKILL_DIR}/scripts/server.js > /tmp/debug-skill-server.log 2>&1 & echo $! > /tmp/debug-skill-server.pid && sleep 0.5 && curl -s http://127.0.0.1:9323/health)
```

To use a different port: `DEBUG_PORT=9324 node ${CLAUDE_SKILL_DIR}/scripts/server.js ...`

---

## Phase 2 — Start a session

Generate a session ID and note the context:

```bash
SESSION_ID=$(openssl rand -hex 3) && echo "session_id=${SESSION_ID}" && echo "marker=__MCPDBG:${SESSION_ID}__" && echo "endpoint=http://127.0.0.1:9323"
```

- **`session_id`** — unique identifier for this debugging session
- **`marker`** — string that tags every inserted line (e.g. `__MCPDBG:abc123__`)

Sessions are created automatically on the first `POST /log` — no explicit creation step needed.

---

## Phase 3 — Instrument the code

Insert fire-and-forget log calls at the points of interest. **Every inserted line must carry the marker as a trailing comment** — this is the only way cleanup (Phase 6) can find them.

Replace `SESSION_ID`, `LABEL`, and `DATA` with actual values.

### Browser / Web frontend (fetch API)
```js
fetch('http://127.0.0.1:9323/log', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:'SESSION_ID',label:'LABEL',data:DATA})}).catch(()=>{}); // __MCPDBG:SESSION_ID__
```

### Node.js (fetch, Node 18+)
```js
fetch('http://127.0.0.1:9323/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:'SESSION_ID',label:'LABEL',data:DATA})}).catch(()=>{}); // __MCPDBG:SESSION_ID__
```

### Node.js (http module, older versions)
```js
require('http').request({hostname:'127.0.0.1',port:9323,path:'/log',method:'POST',headers:{'Content-Type':'application/json'}},()=>{}).on('error',()=>{}).end(JSON.stringify({session_id:'SESSION_ID',label:'LABEL',data:DATA})); // __MCPDBG:SESSION_ID__
```

### Python
```python
__import__('threading').Thread(target=lambda:__import__('urllib.request',fromlist=['urlopen']).urlopen(__import__('urllib.request',fromlist=['Request']).Request('http://127.0.0.1:9323/log',__import__('json').dumps({'session_id':'SESSION_ID','label':'LABEL','data':DATA}).encode(),[('Content-Type','application/json')])),daemon=True).start() # __MCPDBG:SESSION_ID__
```

### Go
```go
go func(){b,_:=json.Marshal(map[string]any{"session_id":"SESSION_ID","label":"LABEL","data":DATA});http.Post("http://127.0.0.1:9323/log","application/json",bytes.NewReader(b))}() // __MCPDBG:SESSION_ID__
```

### Shell / curl
```bash
curl -s -X POST http://127.0.0.1:9323/log -H 'Content-Type: application/json' -d "{\"session_id\":\"SESSION_ID\",\"label\":\"LABEL\",\"data\":\"DATA\"}" &>/dev/null & # __MCPDBG:SESSION_ID__
```

**Rules:**
- Use `// marker` for JS/TS/Go/Rust, `# marker` for Python/shell/Ruby
- Always use `.catch(()=>{})` or equivalent — never let a log call throw or block
- Use descriptive `label` values — you'll filter by them in Phase 5
- `data` accepts any JSON-serializable value
- The optional `source` field accepts `{ "file": "path", "line": 42 }`

---

## Phase 4 — Run the code

Execute the code under investigation normally. Logs accumulate in memory (up to 5000 entries per session; oldest dropped if exceeded).

---

## Phase 5 — Read the logs

### Read all logs
```bash
curl -s http://127.0.0.1:9323/logs/SESSION_ID | jq .
```

### Filter by label (exact match)
```bash
curl -s 'http://127.0.0.1:9323/logs/SESSION_ID?label=LABEL' | jq .
```

### Search by content (substring)
```bash
curl -s 'http://127.0.0.1:9323/logs/SESSION_ID?contains=SEARCH_TERM' | jq .
```

### Entries after a given ID
```bash
curl -s 'http://127.0.0.1:9323/logs/SESSION_ID?since_id=N' | jq .
```

### Paginate (limit + offset)
```bash
curl -s 'http://127.0.0.1:9323/logs/SESSION_ID?limit=50&offset=100' | jq .
```

### Stats by label
```bash
curl -s http://127.0.0.1:9323/stats/SESSION_ID | jq .
```

### List all active sessions
```bash
curl -s http://127.0.0.1:9323/sessions | jq .
```

### Clear logs between runs (keep session alive)
```bash
curl -s -X DELETE http://127.0.0.1:9323/logs/SESSION_ID | jq .
```

---

## Phase 6 — Clean up instrumentation

Remove every injected line using the marker. Do this **before** ending the session.

### 1. Preview what will be removed
Use the Grep tool with pattern `__MCPDBG:SESSION_ID__` across the project root.

Or with Bash:
```bash
grep -rn "__MCPDBG:SESSION_ID__" /path/to/project --include="*.ts" --include="*.js" --include="*.py"
```

### 2. Remove marked lines
For each file found, use the Edit tool to delete every line containing the marker.

Or with sed (macOS):
```bash
sed -i '' '/__MCPDBG:SESSION_ID__/d' /path/to/file
```

Or with sed (Linux):
```bash
sed -i '/__MCPDBG:SESSION_ID__/d' /path/to/file
```

### 3. Verify cleanup
```bash
grep -rn "__MCPDBG:SESSION_ID__" /path/to/project
```
Must return zero results before proceeding.

---

## Phase 7 — End the session

Remove the session from memory:
```bash
curl -s -X DELETE http://127.0.0.1:9323/sessions/SESSION_ID | jq .
```

When all sessions are finished, stop the server:
```bash
kill $(cat /tmp/debug-skill-server.pid) 2>/dev/null && rm -f /tmp/debug-skill-server.pid
```

---

## Quick reference

| Phase | Action | How |
|-------|--------|-----|
| 1 | Start HTTP server | Bash |
| 2 | Generate session ID + marker | Bash |
| 3 | Insert log calls with marker tag | Edit |
| 4 | Run code | Bash |
| 5 | Read / filter / clear logs | `curl /logs/ID` |
| 6 | Remove marker lines from source | Grep + Edit |
| 7 | End session; stop server | `curl -X DELETE`, Bash |

## Important rules

- **Tag every inserted line** with the marker — missing even one means it won't be cleaned up
- **Clean up before ending** — ending the session drops all logs and the marker reference
- **Keep log calls non-blocking** — `.catch(()=>{})` / daemon threads / goroutines only
- Logs are in memory only — they don't survive a server restart
