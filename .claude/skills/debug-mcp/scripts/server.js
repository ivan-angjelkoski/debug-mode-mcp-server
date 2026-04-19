#!/usr/bin/env node
'use strict';

const http = require('http');
const { URL } = require('url');

const PORT = parseInt(process.env.DEBUG_PORT || '9323', 10);
const HOST = process.env.DEBUG_HOST || '127.0.0.1';
const MAX_PAYLOAD = 1024 * 1024; // 1 MB
const MAX_LOGS = parseInt(process.env.DEBUG_MAX_LOGS || '5000', 10);

// sessions: Map<session_id, { logs: LogEntry[], totalEver: number }>
const sessions = new Map();
let logIdCounter = 1;

function getOrCreate(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, { logs: [], totalEver: 0 });
  return sessions.get(sessionId);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > MAX_PAYLOAD) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', function () { resolve(body); });
    req.on('error', reject);
  });
}

const server = http.createServer(async function (req, res) {
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const base = 'http://' + HOST + ':' + PORT;
  const url = new URL(req.url, base);
  const path = url.pathname;

  // GET /health
  if (req.method === 'GET' && path === '/health') {
    return json(res, 200, { ok: true, port: PORT, pid: process.pid, sessions: sessions.size });
  }

  // GET /sessions
  if (req.method === 'GET' && path === '/sessions') {
    const list = [];
    sessions.forEach(function (s, id) {
      list.push({ session_id: id, buffered: s.logs.length, total: s.totalEver });
    });
    return json(res, 200, { sessions: list });
  }

  // POST /log
  if (req.method === 'POST' && path === '/log') {
    let raw;
    try { raw = await readBody(req); }
    catch (e) { return json(res, e.status || 400, { error: e.message }); }

    let entry;
    try { entry = JSON.parse(raw); }
    catch { return json(res, 400, { error: 'Invalid JSON' }); }

    if (!entry.session_id || typeof entry.session_id !== 'string') {
      return json(res, 400, { error: 'session_id is required' });
    }

    const session = getOrCreate(entry.session_id);
    const logEntry = {
      id: logIdCounter++,
      ts: new Date().toISOString(),
      label: entry.label != null ? entry.label : null,
      data: entry.data != null ? entry.data : null,
      source: entry.source != null ? entry.source : null,
    };

    session.logs.push(logEntry);
    session.totalEver++;
    if (session.logs.length > MAX_LOGS) session.logs.shift();

    return json(res, 200, { ok: true, id: logEntry.id });
  }

  // GET /logs/:session_id  — filter: label, contains, since_id, limit, offset
  const logsMatch = path.match(/^\/logs\/([^/]+)$/);
  if (req.method === 'GET' && logsMatch) {
    const session = sessions.get(logsMatch[1]);
    if (!session) return json(res, 404, { error: 'Session not found' });

    const label    = url.searchParams.get('label');
    const contains = url.searchParams.get('contains');
    const sinceId  = url.searchParams.has('since_id') ? parseInt(url.searchParams.get('since_id'), 10) : null;
    const limit    = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 2000);
    const offset   = parseInt(url.searchParams.get('offset') || '0', 10);

    let matched = session.logs;
    if (sinceId !== null)  matched = matched.filter(function (e) { return e.id > sinceId; });
    if (label !== null)    matched = matched.filter(function (e) { return e.label === label; });
    if (contains !== null) matched = matched.filter(function (e) { return JSON.stringify(e).includes(contains); });

    const page = matched.slice(offset, offset + limit);
    return json(res, 200, {
      logs: page,
      totalMatched: matched.length,
      buffered: session.logs.length,
      total: session.totalEver,
      truncated: session.totalEver > session.logs.length,
    });
  }

  // GET /stats/:session_id
  const statsMatch = path.match(/^\/stats\/([^/]+)$/);
  if (req.method === 'GET' && statsMatch) {
    const session = sessions.get(statsMatch[1]);
    if (!session) return json(res, 404, { error: 'Session not found' });

    const byLabel = {};
    session.logs.forEach(function (e) {
      const k = e.label != null ? e.label : 'unlabeled';
      byLabel[k] = (byLabel[k] || 0) + 1;
    });
    return json(res, 200, {
      total: session.totalEver,
      buffered: session.logs.length,
      truncated: session.totalEver > session.logs.length,
      firstTs: session.logs.length ? session.logs[0].ts : null,
      lastTs:  session.logs.length ? session.logs[session.logs.length - 1].ts : null,
      byLabel,
    });
  }

  // DELETE /logs/:session_id  — clear logs, keep session
  if (req.method === 'DELETE' && logsMatch) {
    const session = sessions.get(logsMatch[1]);
    if (!session) return json(res, 404, { error: 'Session not found' });
    const cleared = session.logs.length;
    session.logs = [];
    return json(res, 200, { cleared });
  }

  // DELETE /sessions/:session_id  — end session entirely
  const sessMatch = path.match(/^\/sessions\/([^/]+)$/);
  if (req.method === 'DELETE' && sessMatch) {
    if (!sessions.has(sessMatch[1])) return json(res, 404, { error: 'Session not found' });
    sessions.delete(sessMatch[1]);
    return json(res, 200, { ok: true });
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, function () {
  console.log('debug-skill server listening on http://' + HOST + ':' + PORT);
  console.log('PID=' + process.pid);
});

server.on('error', function (err) {
  if (err.code === 'EADDRINUSE') {
    console.error('Port ' + PORT + ' already in use. Set DEBUG_PORT env var to use a different port.');
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

process.on('SIGTERM', function () { server.close(function () { process.exit(0); }); });
process.on('SIGINT', function () { server.close(function () { process.exit(0); }); });
