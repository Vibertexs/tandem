// Stands in for `codex exec` in tests (TANDEM_CODEX): no OpenAI call. Reads the prompt from stdin,
// writes one file in the worktree and its final message where --output-last-message says, and
// records what it was given next to that message.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
let prompt = '';
process.stdin.on('data', d => { prompt += d; });
process.stdin.on('end', () => {
  const cwd = value('--cd');
  const last = value('--output-last-message');
  const config = readFileSync(join(process.env.CODEX_HOME, 'config.toml'), 'utf8');
  writeFileSync(join(cwd, 'hello_codex.py'), 'print("hello from codex")\n');
  writeFileSync(last, 'Wrote hello_codex.py');
  writeFileSync(`${last}.seen.json`, JSON.stringify({ args, prompt, config }));
});
