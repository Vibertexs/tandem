// Prints the identity this machine's MCP server uses. Authorize it as an operator on the dashboard
// (live mode, "Authorize another identity") so the manager tools work in the live session.
import { BrainClient } from './brain-client.js';

const brain = await BrainClient.connect(
  process.env.STDB_URI ?? 'ws://127.0.0.1:3001',
  process.env.STDB_DB ?? 'bilal-dev',
  process.env.TANDEM_SESSION ?? 'live',
);
console.log(brain.identity);
brain.disconnect();
// Give the socket a moment to close; exiting at once trips a libuv assertion on Windows.
setTimeout(() => process.exit(0), 300);
