/**
 * Static file server for a reference folder, so the snapshot loads its fonts and assets over http
 * (Chromium refuses @font-face from file://). Port 0 = any free port.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };

export async function serveDir(dir: string, port = 0): Promise<{ url: string; stop: () => void }> {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    let p = path.join(root, decodeURIComponent(u.pathname));
    if (!p.startsWith(root)) { res.writeHead(403).end('no'); return; }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p).toLowerCase()] ?? 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
  const actual = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${actual}`, stop: () => { server.closeAllConnections?.(); server.close(); } };
}
