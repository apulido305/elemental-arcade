// Node http server: serves the repo statically and exposes the shared Backend to browser pages.
//   POST /__fb/rpc      {op,args,token}        -> {ok:true,result} | {ok:false,error:{code,message}}
//   GET  /__fb/stream?cid=                      Server-Sent Events (one stream per page; carries onSnapshot pushes)
//   POST /__fb/listen   {cid,lid,spec,token}    register a snapshot listener
//   POST /__fb/unlisten {cid,lid}
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.md': 'text/plain', '.woff2': 'font/woff2', '.webp': 'image/webp' };

export function startServer(backend, { port = 0, latencyMs = 0 } = {}) {
  const streams = new Map();   // cid -> {res, unsubs: Map(lid -> fn)}
  const body = req => new Promise((res, rej) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch (e) { rej(e); } }); });
  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/__fb/rpc' && req.method === 'POST') {
        const b = await body(req);
        if (latencyMs) await sleep(latencyMs);
        try { json(res, 200, { ok: true, result: (await backend.call(b.op, b.args, b.token)) ?? null }); }
        catch (e) { json(res, 200, { ok: false, error: { code: e.code || 'unknown', message: e.message } }); }
        return;
      }
      if (url.pathname === '/__fb/stream') {
        const cid = url.searchParams.get('cid');
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write('data: {"hello":1}\n\n');
        const s = { res, unsubs: new Map() }; streams.set(cid, s);
        req.on('close', () => { s.unsubs.forEach(u => u()); streams.delete(cid); });
        return;
      }
      if (url.pathname === '/__fb/listen' && req.method === 'POST') {
        const b = await body(req); const s = streams.get(b.cid);
        if (!s) return json(res, 200, { ok: false });
        s.unsubs.set(b.lid, backend.listen(b.token, b.spec, ev => { if (latencyMs) setTimeout(() => s.res.write('data: ' + JSON.stringify({ lid: b.lid, ...ev }) + '\n\n'), latencyMs); else s.res.write('data: ' + JSON.stringify({ lid: b.lid, ...ev }) + '\n\n'); }));
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/__fb/unlisten' && req.method === 'POST') {
        const b = await body(req); const s = streams.get(b.cid);
        if (s && s.unsubs.has(b.lid)) { s.unsubs.get(b.lid)(); s.unsubs.delete(b.lid); }
        return json(res, 200, { ok: true });
      }
      // static
      let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
      const file = path.resolve(REPO, '.' + p);
      if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (e) { res.writeHead(500); res.end(String(e && e.message)); }
  });

  return new Promise(resolve => server.listen(port, '127.0.0.1', () => {
    const origin = 'http://127.0.0.1:' + server.address().port;
    resolve({
      origin, server,
      close: () => new Promise(r => { streams.forEach(s => { s.unsubs.forEach(u => u()); s.res.end(); }); server.closeAllConnections?.(); server.close(() => r()); })
    });
  }));
}
