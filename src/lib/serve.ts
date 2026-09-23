/**
 * Static file server for a reference folder, so the snapshot loads its fonts and assets over http
 * (Chromium refuses @font-face from file://). Port 0 = any free port.
 */
import fs from 'node:fs';
import path from 'node:path';

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };

export function serveDir(dir: string, port = 0) {
  const root = path.resolve(dir);
  const server = Bun.serve({
    port,
    fetch(req) {
      const u = new URL(req.url);
      let p = path.join(root, decodeURIComponent(u.pathname));
      if (!p.startsWith(root)) return new Response('no', { status: 403 });
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!fs.existsSync(p)) return new Response('not found', { status: 404 });
      return new Response(Bun.file(p), { headers: { 'content-type': TYPES[path.extname(p).toLowerCase()] ?? 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
    },
  });
  return { url: `http://localhost:${server.port}`, stop: () => server.stop(true) };
}
