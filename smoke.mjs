import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const proc = spawn('node', ['dist/index.mjs'], {
  cwd: new URL('.', import.meta.url).pathname,
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, DEBUG_MCP_PORT: '9323' },
})

let buffer = ''
const pending = new Map()
let nextId = 1

proc.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  let idx
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { console.error('bad line:', line); continue }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  }
})

function rpc(method, params) {
  const id = nextId++
  const msg = { jsonrpc: '2.0', id, method, params }
  proc.stdin.write(JSON.stringify(msg) + '\n')
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function run() {
  await delay(300)

  console.log('\n1. initialize')
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0' },
  })
  console.log('   server:', init.serverInfo)
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

  console.log('\n2. tools/list')
  const list = await rpc('tools/list', {})
  console.log('   tools:', list.tools.map((t) => t.name).join(', '))

  console.log('\n3. start_session')
  const startRes = await rpc('tools/call', {
    name: 'start_session',
    arguments: { name: 'smoke' },
  })
  const startPayload = JSON.parse(startRes.content[0].text)
  console.log('   session_id:', startPayload.session_id)
  console.log('   marker:    ', startPayload.marker)
  console.log('   endpoint:  ', startPayload.log_endpoint)
  const { session_id, log_endpoint, marker } = startPayload

  console.log('\n4. POST /log x 3')
  for (const [label, data] of [
    ['hypothesis-1', { value: 42, branch: 'left' }],
    ['hypothesis-1', { value: 43, branch: 'right' }],
    ['hypothesis-2', 'a plain string'],
  ]) {
    const r = await fetch(`${log_endpoint}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id, label, data }),
    })
    console.log('   POST', label, '→', r.status)
  }

  console.log('\n5. log_stats')
  const stats = await rpc('tools/call', { name: 'log_stats', arguments: { session_id } })
  console.log('   ', JSON.parse(stats.content[0].text))

  console.log('\n6. get_logs (label filter)')
  const logsByLabel = await rpc('tools/call', {
    name: 'get_logs',
    arguments: { session_id, label: 'hypothesis-1' },
  })
  const payload = JSON.parse(logsByLabel.content[0].text)
  console.log('   matched:', payload.totalMatched, 'entries returned:', payload.logs.length)
  for (const e of payload.logs) console.log('    -', e.id, e.label, JSON.stringify(e.data))

  console.log('\n7. instrumentation remove (dry_run) on throwaway tmp file')
  const tmpFile = '/tmp/debug-mcp-smoke-target.js'
  const { writeFile, readFile, rm, mkdir } = await import('node:fs/promises')
  const tmpDir = '/tmp/debug-mcp-smoke-root'
  await rm(tmpDir, { recursive: true, force: true })
  await mkdir(tmpDir, { recursive: true })
  const tmp = `${tmpDir}/target.js`
  await writeFile(
    tmp,
    [
      'function doThing() {',
      `  fetch('http://x/log', {body: JSON.stringify({session_id: 'x'})}); // ${marker}`,
      '  return 1;',
      `  console.log('debug'); // ${marker}`,
      '}',
      '',
    ].join('\n'),
  )
  const dry = await rpc('tools/call', {
    name: 'remove_instrumentation',
    arguments: { session_id, root: tmpDir, dry_run: true },
  })
  console.log('   dry:', JSON.parse(dry.content[0].text))

  console.log('\n8. instrumentation remove (for real)')
  const real = await rpc('tools/call', {
    name: 'remove_instrumentation',
    arguments: { session_id, root: tmpDir, dry_run: false },
  })
  console.log('   real:', JSON.parse(real.content[0].text))
  const after = await readFile(tmp, 'utf8')
  console.log('   file after:\n' + after)
  await rm(tmpDir, { recursive: true, force: true })

  console.log('\n9. end_session')
  const end = await rpc('tools/call', { name: 'end_session', arguments: { session_id } })
  console.log('   ', JSON.parse(end.content[0].text))

  proc.kill('SIGTERM')
  await delay(200)
  console.log('\nOK')
}

run().catch((err) => {
  console.error('FAIL:', err)
  proc.kill('SIGTERM')
  process.exit(1)
})
