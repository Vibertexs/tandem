// Run in the background by `tandem start`: serves one project over HTTP (see gitshare.ts).
//   node gitserver.ts <repo> <listen address> <port>
import { backendPath, serveRepo } from './gitshare.ts';

const [repo, host, port] = process.argv.slice(2);
const backend = backendPath();
if (!repo || !host || !port || !backend) { console.error('usage: gitserver.ts <repo> <address> <port> (and git must be installed)'); process.exit(2); }
serveRepo(repo, backend).listen(Number(port), host, () => console.log(`serving ${repo} on http://${host}:${port}/`));
