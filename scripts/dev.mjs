import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { Readable } from 'node:stream';
import { proxy } from '../api/index.mjs';

const publicRoot = resolve(import.meta.dirname, '../public');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
    if (url.pathname.startsWith('/api/')) {
      const init = { method: req.method, headers: req.headers };
      if (!['GET', 'HEAD'].includes(req.method)) Object.assign(init, { body: Readable.toWeb(req), duplex: 'half' });
      const response = await proxy(new Request(url, init));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const path = resolve(publicRoot, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!path.startsWith(`${publicRoot}${sep}`) || !(await stat(path)).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': contentTypes[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(path));
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`원헬스 건강 캠페인: http://localhost:${process.env.PORT || 3000}`));
