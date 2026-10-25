// A small guide for the very first project. The browser cannot create folders or change PATH, so
// the one-time setup is explicit and the normal workflow is one Tandem command, not a shell script.
import { useEffect, useState } from 'react';
import { CodeLine } from './ui';

const isWindowsPath = (path: string) => /^[a-z]:[\\/]/i.test(path) || path.includes('\\');
const stripEnd = (path: string) => path.replace(/[\\/]+$/, '');
const shellQuote = (path: string) => `'${path.replace(/'/g, "'\\''")}'`;

function parentFolder(path: string) {
  const clean = stripEnd(path);
  const cut = Math.max(clean.lastIndexOf('\\'), clean.lastIndexOf('/'));
  return cut > 0 ? clean.slice(0, cut) : '';
}

function withChild(parent: string, child: string) {
  const slash = parent.includes('\\') ? '\\' : '/';
  return `${stripEnd(parent)}${slash}${child}`;
}

function newProjectCommand(projectDir: string, windows: boolean) {
  return `tandem init ${windows ? `"${projectDir.replace(/"/g, '\\"')}"` : shellQuote(projectDir)}`;
}

type Props = {
  projectDir?: string;
  say: (message: string) => void;
  idPrefix: string;
};

export function ProjectStarter({ projectDir = '', say, idPrefix }: Props) {
  const windows = isWindowsPath(projectDir) || navigator.userAgent.includes('Windows');
  const base = parentFolder(projectDir) || (windows ? 'C:\\Code' : '/path/to');
  const suggestedProject = withChild(base, 'tandem-test');
  const [newProjectFolder, setNewProjectFolder] = useState(suggestedProject);
  const [projectEdited, setProjectEdited] = useState(false);
  const [existing, setExisting] = useState(false);

  // The connected team tells us its project folder a moment after the page first renders. Preserve
  // what the person typed, but otherwise replace the generic example with that nearby folder.
  useEffect(() => { if (!projectEdited) setNewProjectFolder(suggestedProject); }, [suggestedProject, projectEdited]);

  const ready = newProjectFolder.trim().length > 0;
  const code = ready ? newProjectCommand(newProjectFolder.trim(), windows) : '';
  const install = windows ? '.\\tandem.cmd install' : './tandem install';

  return (
    <section className="project-starter" aria-labelledby={`${idPrefix}-project-h`}>
      <h2 id={`${idPrefix}-project-h`}>Start a new project</h2>
      <p className="small muted">Tandem stays in its own folder. Tell it where the new project belongs; it creates the folder, sets up Git, and opens the Board.</p>
      <details className="start-help">
        <summary className="small">First time on this computer, or is <code className="mono">tandem</code> not recognised?</summary>
        <p className="small muted">In Tandem&apos;s own folder, run this once. Then close PowerShell or Terminal and open a new one.</p>
        <CodeLine code={install} say={say} />
      </details>
      <label className="check-row" htmlFor={`${idPrefix}-existing`}>
        <input id={`${idPrefix}-existing`} type="checkbox" checked={existing} onChange={e => setExisting(e.target.checked)} />
        I already have a Git project
      </label>
      {existing
        ? <>
          <p className="small"><strong>Start that project</strong> <span className="muted">Open PowerShell or Terminal in its folder, then run:</span></p>
          <CodeLine code="tandem --start" say={say} />
        </>
        : <div className="form project-starter-form">
          <label htmlFor={`${idPrefix}-project`}>New project folder
            <input id={`${idPrefix}-project`} value={newProjectFolder} onChange={e => { setProjectEdited(true); setNewProjectFolder(e.target.value); }} placeholder={windows ? 'C:\\Code\\tandem-test' : '/path/to/tandem-test'} />
          </label>
          {ready
            ? <>
              <p className="small"><strong>Create the project and start Tandem</strong> <span className="muted">Copy one normal Tandem command into PowerShell or Terminal.</span></p>
          <CodeLine code={code} say={say} />
              <p className="small muted">It refuses to touch a folder that already exists, so your files stay safe.</p>
            </>
            : <p className="small warn">Enter the new project folder to make the command.</p>}
        </div>}
    </section>
  );
}
