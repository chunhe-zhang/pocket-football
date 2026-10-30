#!/usr/bin/env node
// Genshin football room server — no dependencies, Node 18+.
//  * serves the game's static files
//  * relays WebSocket messages between a room's host and its guests (/ws)
// The match itself runs in the host's browser; this server never simulates.
//
//   node server/server.js            # port 8080
//   PORT=80 node server/server.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +(process.env.PORT || process.argv[2] || 8080);
const ROOT = path.resolve(__dirname, '..');
const MAX_ROOM = 4;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};

// ---- static files ----------------------------------------------------------------
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT) || /[\\/]\.|[\\/]server[\\/]|[\\/]tools[\\/]/.test(file.slice(ROOT.length))) { res.writeHead(404); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const big = /\.(glb|vrm)$/i.test(file);
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': big ? 'public, max-age=86400' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

// ---- minimal WebSocket (RFC 6455) ----------------------------------------------------
function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const hash = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${hash}\r\n\r\n`);
  socket.setNoDelay(true);
  const conn = { socket, buf: Buffer.alloc(0), frag: [], alive: true, onText: null, onClose: null, closed: false };
  socket.on('data', (d) => { conn.alive = true; conn.buf = Buffer.concat([conn.buf, d]); parse(conn); });
  socket.on('close', () => close(conn));
  socket.on('error', () => close(conn));
  return conn;
}

function close(conn) {
  if (conn.closed) return;
  conn.closed = true;
  try { conn.socket.destroy(); } catch {}
  conn.onClose?.();
}

function frame(op, payload) {
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x80 | op;
  return Buffer.concat([head, payload]);
}

function sendText(conn, str) {
  if (conn.closed) return;
  try { conn.socket.write(frame(0x1, Buffer.from(str))); } catch { close(conn); }
}

function parse(conn) {
  for (;;) {
    const b = conn.buf;
    if (b.length < 2) return;
    const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    if (len > 1 << 20) { close(conn); return; } // 1 MB cap
    const need = off + (masked ? 4 : 0) + len;
    if (b.length < need) return;
    let data = b.subarray(off + (masked ? 4 : 0), need);
    if (masked) {
      const mask = b.subarray(off, off + 4); data = Buffer.from(data);
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    }
    conn.buf = b.subarray(need);
    if (op === 0x8) { try { conn.socket.write(frame(0x8, Buffer.alloc(0))); } catch {} close(conn); return; }
    if (op === 0x9) { try { conn.socket.write(frame(0xA, data)); } catch {} continue; }
    if (op === 0xA) { conn.alive = true; continue; }
    if (op === 0x1 || op === 0x0) {
      conn.frag.push(data);
      if (fin) { const text = Buffer.concat(conn.frag).toString('utf8'); conn.frag = []; conn.onText?.(text); }
    }
  }
}

// ---- rooms -----------------------------------------------------------------------------
const rooms = new Map(); // code -> { host, guests: Map(id -> conn) }
let nextId = 1;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let c = ''; for (let i = 0; i < 4; i++) c += ALPHA[crypto.randomInt(ALPHA.length)];
    if (!rooms.has(c)) return c;
  }
}
const json = (conn, o) => sendText(conn, JSON.stringify(o));
const clean = (s) => String(s || '').replace(/[<>]/g, '').slice(0, 12) || 'Player';

server.on('upgrade', (req, socket) => {
  if ((req.url || '').split('?')[0] !== '/ws') { socket.destroy(); return; }
  const conn = accept(req, socket);
  if (!conn) return;
  conn.id = String(nextId++);
  conn.onText = (text) => {
    let m; try { m = JSON.parse(text); } catch { return; }
    const room = conn.room ? rooms.get(conn.room) : null;
    switch (m.t) {
      case 'ping': json(conn, { t: 'pong', at: m.at }); break;
      case 'create': {
        if (conn.room) break;
        const code = newCode();
        conn.room = code; conn.isHost = true; conn.name = clean(m.name);
        rooms.set(code, { host: conn, guests: new Map() });
        json(conn, { t: 'created', code, id: conn.id });
        log(`room ${code} created by ${conn.name}`);
        break;
      }
      case 'join': {
        const r = rooms.get(String(m.code || '').toUpperCase());
        if (!r) { json(conn, { t: 'error', msg: '找不到这个房间号' }); break; }
        if (r.guests.size + 1 >= MAX_ROOM) { json(conn, { t: 'error', msg: '房间已满（最多 4 人）' }); break; }
        if (r.started) { json(conn, { t: 'error', msg: '比赛已经开始了，请等这局结束' }); break; }
        conn.room = m.code.toUpperCase(); conn.name = clean(m.name);
        r.guests.set(conn.id, conn);
        json(conn, { t: 'joined', code: conn.room, id: conn.id, host: r.host.name });
        json(r.host, { t: 'peer-join', id: conn.id, name: conn.name });
        log(`${conn.name} joined ${conn.room}`);
        break;
      }
      case 'to-host': if (room && !conn.isHost) json(room.host, { t: 'from', id: conn.id, data: m.data }); break;
      case 'broadcast':
        if (room && conn.isHost) {
          if (m.data?.k === 'start') room.started = true;
          if (m.data?.k === 'lobby') room.started = false;
          const s = JSON.stringify({ t: 'host', data: m.data });
          for (const g of room.guests.values()) sendText(g, s);
        }
        break;
      case 'to': if (room && conn.isHost) { const g = room.guests.get(String(m.id)); if (g) json(g, { t: 'host', data: m.data }); } break;
    }
  };
  conn.onClose = () => {
    const room = conn.room ? rooms.get(conn.room) : null;
    if (!room) return;
    if (conn.isHost) {
      for (const g of room.guests.values()) json(g, { t: 'host-left' });
      rooms.delete(conn.room);
      log(`room ${conn.room} closed`);
    } else {
      room.guests.delete(conn.id);
      json(room.host, { t: 'peer-leave', id: conn.id });
    }
  };
});

// drop dead connections
setInterval(() => {
  for (const r of rooms.values()) for (const c of [r.host, ...r.guests.values()]) {
    if (!c.alive) { close(c); continue; }
    c.alive = false;
    try { c.socket.write(frame(0x9, Buffer.alloc(0))); } catch { close(c); }
  }
}, 15000);

function log(s) { console.log(new Date().toISOString().slice(11, 19), s); }

server.listen(PORT, () => log(`Genshin football server: http://localhost:${PORT}  (rooms on /ws)`));
