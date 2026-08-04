import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const home = homedir();
const desktop = join(home, 'Desktop', 'dsktop');
const instruments = [
  { name: 'BeatGenerator', port: 8801, root: join(home, 'mycorrhiza-beat', 'site-static'), path: '/' },
  { name: 'BassGenerator', port: 8802, root: join(desktop, 'cad', '3d cad'), path: '/prime-pulse-monolith.html' },
  { name: 'Kagome', port: 8803, root: join(desktop, 'kagome-sound'), path: '/' },
  { name: 'ParticleNoise', port: 8804, root: join(desktop, 'el-systema-bloom-particle-noise'), path: '/' },
  { name: 'GEO/OSC', port: 8805, root: join(desktop, 'el-systema-bloom-geometry-generator'), path: '/' },
  { name: 'GEO/OSC/HUB', port: 8806, root: join(home, 'el-systema-geometry-osc'), path: '/geometry-instruments/master.html' },
  { name: 'CellNoiseGenerator', port: 8807, root: join(desktop, 'CellnoiseGenerator'), path: '/public/launch-20260524c.html' },
  { name: 'Stonebeats / Ocean', port: 8808, root: join(desktop, 'el-systema-acid-live'), path: '/stone-beats.html' },
  { name: 'Planarian Drone', port: 8809, root: join(desktop, 'PLANARIAN-DRONE', 'site-static'), path: '/' }
];
const relayInstruments = [
  { name: 'HADO / HEN', path: '/instruments/hado-hen/' },
  { name: 'HADO / DUST', path: '/instruments/hado-dust/' },
  { name: 'HADO / FIELD', path: '/instruments/hado-field/' },
  { name: 'HADO / ORI', path: '/instruments/hado-ori/' },
  { name: 'TSUKI SOUND', path: '/instruments/tsuki-sound/' }
];

const mime = {
  '.css': 'text/css; charset=utf-8', '.gif': 'image/gif', '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', '.wav': 'audio/wav', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2'
};

function createStaticServer(instrument) {
  const root = resolve(instrument.root);
  const server = http.createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
      if (pathname === '/favicon.ico') {
        response.writeHead(204);
        return response.end();
      }
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = resolve(root, '.' + pathname);
      if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(403);
        return response.end('forbidden');
      }
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      const body = request.method === 'HEAD' ? null : await readFile(file);
      response.writeHead(200, {
        'content-type': mime[extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
    }
  });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') console.error(`[local] :${instrument.port} is already in use (${instrument.name})`);
    else console.error(`[local] ${instrument.name}: ${error.message}`);
  });
  server.listen(instrument.port, '127.0.0.1', () => {
    console.log(`[local] ${instrument.name.padEnd(20)} http://localhost:${instrument.port}${instrument.path}?field`);
  });
  return server;
}

const relay = spawn(process.execPath, [join(here, 'relay.mjs')], { stdio: 'inherit' });
const servers = instruments.map(createStaticServer);
for (const instrument of relayInstruments) {
  console.log('[local] ' + instrument.name.padEnd(20) + ' http://localhost:8787' + instrument.path + '?field');
}

function shutdown(signal) {
  for (const server of servers) server.close();
  if (!relay.killed) relay.kill(signal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log('[local] launcher: http://localhost:8787/local-instruments.html');
