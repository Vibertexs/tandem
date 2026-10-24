// Serves the host's project over HTTP, so a teammate's computer can clone it and push its task
// branches straight back, with no GitHub in between. It hands each request to git's own
// `git http-backend`, which every git install has, on Windows, macOS and Linux.
//
// Branches can be pushed (task/...), but git refuses a push to the branch that is checked out in
// the host's folder. There is no login: only run it where you trust everyone who can reach it (a
// private network such as Tailscale, which is the address Tandem uses when it is running).
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { basename, dirname, join } from 'node:path';

// Where git keeps http-backend.
export function backendPath(): string | null {
  const r = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return join(r.stdout.trim(), process.platform === 'win32' ? 'git-http-backend.exe' : 'git-http-backend');
}

export const gitUrl = (host: string, port: number, repo: string) => `http://${host}:${port}/${basename(repo)}`;

const MAX_BODY = 512 * 1024 * 1024;

export function serveRepo(repo: string, backend: string): Server {
  const name = basename(repo);
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!(url.pathname === `/${name}` || url.pathname.startsWith(`/${name}/`))) { res.writeHead(404).end('no such repository'); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { req.destroy(); } else chunks.push(c); });
    req.on('error', () => res.destroy());
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const child = spawn(backend, [], {
        env: {
          PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
          GIT_PROJECT_ROOT: dirname(repo), GIT_HTTP_EXPORT_ALL: '1',
          // allow pushes (git http-backend refuses them otherwise)
          GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.receivepack', GIT_CONFIG_VALUE_0: 'true',
          REQUEST_METHOD: req.method ?? 'GET', QUERY_STRING: url.search.replace(/^\?/, ''), PATH_INFO: url.pathname,
          CONTENT_TYPE: String(req.headers['content-type'] ?? ''), CONTENT_LENGTH: String(body.length),
          ...(req.headers['content-encoding'] ? { HTTP_CONTENT_ENCODING: String(req.headers['content-encoding']) } : {}),
          REMOTE_ADDR: req.socket.remoteAddress ?? '', GATEWAY_INTERFACE: 'CGI/1.1', SERVER_PROTOCOL: 'HTTP/1.1',
        },
      });
      child.stdin.on('error', () => {});
      child.stdin.end(body);
      // The CGI answer is headers, a blank line, then the body.
      let head = Buffer.alloc(0);
      let sent = false;
      child.stdout.on('data', (d: Buffer) => {
        if (sent) { res.write(d); return; }
        head = Buffer.concat([head, d]);
        const end = head.indexOf('\r\n\r\n');
        const alt = head.indexOf('\n\n');
        const cut = end >= 0 ? end + 4 : alt >= 0 ? alt + 2 : -1;
        if (cut < 0) return;
        const headers: Record<string, string> = {};
        let status = 200;
        for (const line of head.subarray(0, cut).toString('latin1').split(/\r?\n/)) {
          const i = line.indexOf(':');
          if (i < 0) continue;
          const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim();
          if (k.toLowerCase() === 'status') status = parseInt(v, 10) || 200; else headers[k] = v;
        }
        res.writeHead(status, headers);
        sent = true;
        if (head.length > cut) res.write(head.subarray(cut));
      });
      child.on('error', () => { if (!sent) res.writeHead(500).end('git http-backend failed to start'); });
      child.on('close', () => { if (!sent) res.writeHead(502).end('git http-backend gave no answer'); else res.end(); });
    });
  });
}

// A free port at or after `start` on `host`.
export function freePort(start: number, host: string): Promise<number> {
  return new Promise(resolve => {
    const tryPort = (p: number) => {
      const s = createServer();
      s.once('error', () => tryPort(p + 1));
      s.listen(p, host, () => s.close(() => resolve(p)));
    };
    tryPort(start);
  });
}
