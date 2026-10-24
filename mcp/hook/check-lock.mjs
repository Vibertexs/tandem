#!/usr/bin/env node
// PreToolUse hook: blocks an edit to a file that another worker's task has locked.
// Claude Code passes the tool call as JSON on stdin. Exit 2 blocks the call and shows stderr to
// Claude; exit 0 lets it go ahead (docs: https://code.claude.com/docs/en/hooks).
// Plain JavaScript on purpose: it runs before every edit, so it must start fast.
//
// Env:
//   TANDEM_WORKER_ID  who this Claude is (set by the launcher). Its own locks never block it.
//   TANDEM_SESSION    default "live"
//   STDB_URI, STDB_DB default ws://127.0.0.1:3001 and bilal-dev
//   CLAUDE_PROJECT_DIR the repo root (set by Claude Code); falls back to the event's cwd
// If the brain cannot be reached it lets the edit through and warns: a hook that blocks all
// editing when the network blips would be worse than no hook.
import { relative, isAbsolute, resolve } from 'node:path';

const read = async () => {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
};

async function main() {
  let event;
  try { event = JSON.parse(await read()); } catch { return 0; }
  const input = event.tool_input ?? {};
  const file = input.file_path ?? input.notebook_path;
  if (typeof file !== 'string' || !file) return 0;

  const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
  const abs = isAbsolute(file) ? file : resolve(root, file);
  const rel = relative(root, abs).split('\\').join('/');
  if (!rel || rel.startsWith('../') || isAbsolute(rel)) return 0; // outside the repo: not ours

  const session = process.env.TANDEM_SESSION || 'live';
  const me = process.env.TANDEM_WORKER_ID || '';
  const http = (process.env.STDB_URI || 'ws://127.0.0.1:3001').replace(/^ws/, 'http');
  const db = process.env.STDB_DB || 'bilal-dev';
  const key = `${session}/${rel}`.replace(/'/g, "''");

  let lock;
  try {
    const res = await fetch(`${http}/v1/database/${encodeURIComponent(db)}/sql`, {
      method: 'POST',
      body: `SELECT * FROM locks WHERE pk = '${key}'`,
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const [result] = await res.json();
    const names = result.schema.elements.map(e => e.name.some);
    const row = result.rows[0];
    if (row) lock = Object.fromEntries(names.map((n, i) => [n, row[i]]));
  } catch (e) {
    process.stderr.write(`tandem lock check skipped (brain unreachable: ${e.message})\n`);
    return 0;
  }

  if (!lock || (me && lock.worker_id === me)) return 0;
  process.stderr.write(
    `Blocked by Tandem: ${rel} is locked by task ${lock.task_id} (worker ${lock.worker_id}). ` +
    `Do not edit it and do not work around it. Call report_progress to say you are blocked by ${lock.task_id}, ` +
    `then finish the rest of your task without this file.\n`);
  return 2;
}

process.exitCode = await main();
