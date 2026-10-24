#!/usr/bin/env node
// What the tandem launchers run. Checks the Node version first, so an old Node gets a clear
// message instead of an error about a .ts file, then hands over to tandem.ts.
import { oldNodeMessage, tooOld } from './node-check.mjs';

if (tooOld()) {
  console.error(`\n${oldNodeMessage()}\n`);
  process.exit(1);
}
await import('./tandem.ts');
