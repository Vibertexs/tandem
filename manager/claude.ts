// Starts Claude Code. On Windows, Claude Code installed with its native installer is claude.exe,
// which spawn can run. Installed with npm it is claude.cmd, which Windows can only run through a
// shell: spawn('claude') then fails with "spawn claude ENOENT".
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export type ClaudeCommand = { file: string; shell: boolean };

export function claudeCommand(pathVar = process.env.PATH ?? '', platform = process.platform): ClaudeCommand {
  if (platform !== 'win32') return { file: 'claude', shell: false };
  const dirs = pathVar.split(delimiter).filter(Boolean);
  for (const ext of ['.exe', '.cmd', '.bat']) {
    for (const dir of dirs) {
      const p = join(dir, `claude${ext}`);
      if (existsSync(p)) return { file: p, shell: ext !== '.exe' };
    }
  }
  return { file: 'claude', shell: false };
}

// An argument cmd.exe will read as one piece.
const quote = (a: string) => (/[\s"&|<>^()%!]/.test(a) || a === '' ? `"${a.replace(/"/g, '\\"')}"` : a);

// stdin, stdout and stderr are pipes (no `stdio` option), as every caller uses them.
export function spawnClaude(args: string[], options: Omit<SpawnOptions, 'stdio'>, pathVar?: string): ChildProcessWithoutNullStreams {
  const c = claudeCommand(pathVar);
  if (!c.shell) return spawn(c.file, args, options);
  return spawn(`"${c.file}" ${args.map(quote).join(' ')}`, { ...options, shell: true });
}
