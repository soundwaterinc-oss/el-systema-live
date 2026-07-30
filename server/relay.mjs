// EL-SYSTEMA Live — 中継（relay）＋静的配信、依存ゼロ。
//
//   node server/relay.mjs [port]
//
// 一つの :8787 で
//   - http:  ../ 以下（hub.html と shared/）を静的配信 → http://localhost:8787/hub.html
//   - ws:    同ポートを WebSocket にアップグレードして「場（field）」を中継
//            （受けた text フレームを送信元以外の全クライアントへそのまま転送）
// 既存 shared/el-systema-transport.js の既定 ws://localhost:8787 にそのまま繋がる。
// https 配信の楽器ページからでも ws://localhost は Chrome で許可される。

import http from 'http';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, normalize, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');                       // el-systema-live/
const PORT = Number(process.argv[2]) || 8787;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.map': 'application/json' };

// ───────────────────────── static http ─────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/hub.html';
    const fp = normalize(join(ROOT, p));
    if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    const body = await readFile(fp);
    res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream',
      'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

// ───────────────────────── websocket field ─────────────────────────
const clients = new Set();

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.__buf = Buffer.alloc(0);
  clients.add(socket);

  socket.on('data', (chunk) => {
    socket.__buf = Buffer.concat([socket.__buf, chunk]);
    let frame;
    while ((frame = decodeFrame(socket.__buf))) {
      socket.__buf = frame.rest;
      if (frame.opcode === 0x8) { closeSocket(socket); return; }        // close
      if (frame.opcode === 0x9) { socket.write(encodeFrame(frame.payload, 0xA)); continue; } // ping→pong
      if (frame.opcode === 0xA) continue;                                // pong
      if (frame.opcode === 0x1 || frame.opcode === 0x0) {                // text / continuation
        const out = encodeFrame(frame.payload, 0x1);
        for (const c of clients) if (c !== socket && !c.destroyed) { try { c.write(out); } catch {} }
      }
    }
  });
  socket.on('error', () => closeSocket(socket));
  socket.on('close', () => clients.delete(socket));
});

function closeSocket(sock) { try { sock.end(); } catch {} clients.delete(sock); }

// Decode one WS frame from buf; returns {opcode, payload(Buffer), rest} or null if incomplete.
// Handles client-masked frames and 7/16/64-bit lengths. (Small JSON control messages.)
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
  const maskLen = masked ? 4 : 0;
  if (buf.length < off + maskLen + len) return null;
  let payload;
  if (masked) {
    const mask = buf.subarray(off, off + 4);
    payload = Buffer.allocUnsafe(len);
    const start = off + 4;
    for (let i = 0; i < len; i++) payload[i] = buf[start + i] ^ mask[i & 3];
  } else {
    payload = buf.subarray(off, off + len);
  }
  return { opcode, payload, rest: buf.subarray(off + maskLen + len) };
}

// Encode an unmasked server frame.
function encodeFrame(payload, opcode = 0x1) {
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.from([0x80 | opcode, len]); }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}

server.listen(PORT, () => {
  console.log(`EL-SYSTEMA field relay + hub on http://localhost:${PORT}/hub.html`);
  console.log(`  ws field:  ws://localhost:${PORT}   (instruments' default)`);
});
