// Help: the commands to run, what each option does, which models each effort uses, and the words
// the page uses. The same commands as `tandem --help` (cli/tandem.ts), with copy buttons.
import type { Snapshot } from './brain';
import { shareable, type Team } from './config';
import { CodeLine, LEVELS } from './ui';

type Cmd = { code: string; what: string };

const DAILY: Cmd[] = [
  { code: 'tandem --start', what: 'In your project folder: start the team. Your computer becomes the conductor and the page opens.' },
  { code: 'tandem', what: 'Open the page (or say how to start, if nothing runs).' },
  { code: 'tandem status', what: "What is running, with each team's links." },
  { code: 'tandem stop', what: 'Stop what this computer started. The brain keeps running.' },
  { code: 'tandem stop --all', what: 'Also stop the brain. Use it before starting again with new code.' },
  { code: 'tandem logs conductor', what: 'The latest log lines of one part: conductor, a worker\'s name, brain or page. Without a name: all.' },
];
const SETUP: Cmd[] = [
  { code: '.\\tandem.cmd install', what: 'Once, in the Tandem folder: put tandem on your PATH (macOS and Linux: ./tandem install). Open a new terminal after.' },
  { code: 'tandem doctor', what: 'Check this computer has Node, Git, Claude Code, SpacetimeDB and Tailscale. Changes nothing.' },
  { code: 'tandem account add work', what: 'A second Claude login for workers (its own folder; your login is not touched). Also: tandem account list, tandem account remove work.' },
  { code: 'tandem uninstall', what: 'Take tandem off your PATH again.' },
];
const OPTIONS: [string, string][] = [
  ['--workers N', 'Workers on this computer (default 1; 0 = none).'],
  ['--local', 'Only this computer can join (default: your network can).'],
  ['--team NAME', "The team's name (default: the folder's name)."],
  ['--fresh', 'Start the board over (goals, tasks, notes, activity). Your project is not touched; teammates join again.'],
  ['--review', 'A worker reviews each goal before it is done.'],
  ['--push', 'Push task and goal branches to origin (a PR per goal with the GitHub CLI).'],
  ['--model NAME', "Force one model for every task, instead of the goal's effort."],
  ['--conductor-model NAME', "Force the model the conductor plans with, instead of the goal's effort."],
  ['--notify URL', 'Post "goal done" to a Slack or Discord webhook.'],
  ['--accounts all|a,b', 'One worker per saved account, instead of --workers.'],
  ['--no-browser', 'Do not open the page.'],
];
const WORDS: [string, string][] = [
  ['Conductor', 'You, and your computer: it ran tandem --start, holds the project, plans goals (Conductor Claude) and merges the work.'],
  ['Teammate', 'Another computer that joined with the invite. It lends its Claude workers; its person can watch, or send goals once approved.'],
  ['Goal', 'What you asked for. The conductor splits it into tasks, each with an exact list of files.'],
  ['Worker', 'One Claude Code on a computer. It claims a task, locks its files, does it in its own git worktree and pushes a branch.'],
  ['Big job', 'Many independent pieces (map), then one task that merges their results (reduce).'],
  ['Effort', 'Low, Medium or High, picked per goal. It decides which models plan and do the work (below).'],
  ['Shared notes', 'Project summary, Interfaces and Decisions: given to every worker before each task.'],
];
const ROWS: [string, (l: (typeof LEVELS)[string]) => { model: string; effort: string }][] = [
  ['Plans the goal', l => l.conductor],
  ['Easy task', l => l.difficulty.easy], ['Normal task', l => l.difficulty.normal], ['Hard task', l => l.difficulty.hard],
  ['Map piece', l => l.kind.map], ['Merge (reduce)', l => l.kind.reduce],
];
const pick = (p: { model: string; effort: string }) => (p.effort === 'default' ? p.model : `${p.model}, ${p.effort}`);

function Commands({ list, say }: { list: Cmd[]; say: (m: string) => void }) {
  return (
    <ul className="plain help-cmds">
      {list.map(c => <li key={c.code}><CodeLine code={c.code} say={say} /><span className="small muted">{c.what}</span></li>)}
    </ul>
  );
}

export function HelpPage({ snap, team, say }: { snap: Snapshot; team: Team; say: (m: string) => void }) {
  const share = shareable(team);
  const join: Cmd = { code: `tandem join "${share?.page ?? '<invite link>'}"`, what: "On a teammate's computer, from any folder: copy the conductor's project and start its workers. Add --workers N for more." };
  const dir = snap.context.tandem_dir;
  return (
    <div className="page help">
      <p className="muted lead">The commands, in a terminal. <code className="mono">tandem --help</code> prints the same list.{dir ? <> Not on your PATH yet? Use the full path, <code className="mono nowrap">&amp; &apos;{dir}\tandem.cmd&apos; --start</code>.</> : null}</p>

      <section className="card" aria-labelledby="help-daily"><h2 id="help-daily">Every day</h2><Commands list={DAILY} say={say} /></section>
      <section className="card" aria-labelledby="help-join"><h2 id="help-join">Add a teammate</h2><Commands list={[join]} say={say} /></section>
      <section className="card" aria-labelledby="help-setup"><h2 id="help-setup">Setting up</h2><Commands list={SETUP} say={say} /></section>

      <section className="card" aria-labelledby="help-options">
        <h2 id="help-options">Options for tandem --start</h2>
        <dl className="facts help-options">{OPTIONS.map(([k, v]) => <div key={k} className="help-option"><dt><code className="mono">{k}</code></dt><dd>{v}</dd></div>)}</dl>
      </section>

      <section className="card" aria-labelledby="help-effort">
        <h2 id="help-effort">Which model does what</h2>
        <p className="small muted">From <code className="mono">launcher/routing.json</code>, the file the workers read. Near a usage limit a worker steps down one model; a retried task gets at least high effort.</p>
        <div className="table-wrap">
          <table className="help-table">
            <thead><tr><th scope="col">Goal effort</th>{Object.keys(LEVELS).map(k => <th scope="col" key={k}>{k[0].toUpperCase() + k.slice(1)}</th>)}</tr></thead>
            <tbody>{ROWS.map(([label, get]) => <tr key={label}><th scope="row">{label}</th>{Object.values(LEVELS).map((l, i) => <td key={i}>{pick(get(l))}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="help-words">
        <h2 id="help-words">Words</h2>
        <dl className="facts help-options">{WORDS.map(([k, v]) => <div key={k} className="help-option"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </section>

      <section className="card" aria-labelledby="help-keys">
        <h2 id="help-keys">On this page</h2>
        <p className="small"><kbd>/</kbd> jumps to the prompt on the Board. <kbd>Esc</kbd> closes a task&apos;s details.</p>
        <p className="small muted">Something wrong? <code className="mono">tandem doctor</code>, then <code className="mono">tandem logs</code>. To start clean with new code: <code className="mono">tandem stop --all</code>, then <code className="mono">tandem --start</code>.</p>
      </section>
    </div>
  );
}
