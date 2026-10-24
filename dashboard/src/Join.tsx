// "Add a teammate": the one command a teammate runs so their Claude joins this team.
// Teammates do not need approval to work. Only sending goals or changing the team needs an operator.
import { config } from './config';

const copy = (text: string, say: (m: string) => void, what: string) => {
  void navigator.clipboard?.writeText(text).then(() => say(`${what} copied.`), () => say('Could not copy. Select the text instead.'));
};

export function Join({ onClose, say }: { onClose: () => void; say: (m: string) => void }) {
  const install = 'cd brain && npm install && cd ../mcp && npm install';
  const add = `claude mcp add tandem -e STDB_URI=${config.uri} -e STDB_DB=${config.db} -e TANDEM_SESSION=live -- node --import tsx <path-to-repo>/mcp/src/server.ts`;
  const skill = 'mkdir .claude\\skills\\tandem-worker; copy mcp\\skill\\SKILL.md .claude\\skills\\tandem-worker\\SKILL.md';
  const start = 'Register with the tandem tools using my name. Then claim a task, do it, and complete it. Repeat until no tasks are left.';
  const local = /127\.0\.0\.1|localhost/.test(config.uri);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Add a teammate" onClick={onClose}>
      <div className="modal-card join" onClick={e => e.stopPropagation()}>
        <h2>Add a teammate</h2>
        <p className="muted small">Four steps on their machine, inside a clone of this repo.</p>
        <ol className="steps">
          <li><strong>Install once</strong><pre className="mono small">{install}</pre>
            <button type="button" className="link" onClick={() => copy(install, say, 'Command')}>copy</button></li>
          <li><strong>Connect their Claude Code to this team</strong><pre className="mono small">{add}</pre>
            <button type="button" className="link" onClick={() => copy(add, say, 'Command')}>copy</button></li>
          <li><strong>Give their Claude the team rules</strong> (a skill it loads by itself)<pre className="mono small">{skill}</pre>
            <button type="button" className="link" onClick={() => copy(skill, say, 'Command')}>copy</button></li>
          <li><strong>Start Claude Code and tell it</strong><pre className="mono small">{start}</pre>
            <button type="button" className="link" onClick={() => copy(start, say, 'Prompt')}>copy</button></li>
        </ol>
        {local && <p className="small warn">This team lives on your laptop (<code className="mono">{config.uri}</code>), so only this machine can join until the brain is hosted.</p>}
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
