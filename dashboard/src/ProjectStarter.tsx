// A small guide for the very first project. Browsers cannot create folders or start local
// programs, so it makes one complete, copyable terminal block from the folders the person enters.
import { useEffect, useState } from 'react';
import { CodeLine } from './ui';

const isWindowsPath = (path: string) => /^[a-z]:[\\/]/i.test(path) || path.includes('\\');
const stripEnd = (path: string) => path.replace(/[\\/]+$/, '');
const psQuote = (path: string) => `'${path.replace(/'/g, "''")}'`;
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

function starterCommand(tandemDir: string, projectDir: string, existing: boolean) {
  const windows = isWindowsPath(tandemDir) || isWindowsPath(projectDir) || navigator.userAgent.includes('Windows');
  const tandem = `${stripEnd(tandemDir)}${windows ? '\\tandem.cmd' : '/tandem'}`;
  if (windows) {
    const lines = [`$project = ${psQuote(projectDir)}`];
    if (!existing) lines.push('New-Item -ItemType Directory -Force -Path $project | Out-Null', 'Set-Location -LiteralPath $project', 'git init', 'git -c user.name=Tandem -c user.email=tandem@localhost commit --allow-empty -m "Start"');
    else lines.push('Set-Location -LiteralPath $project');
    lines.push(`& ${psQuote(tandem)} --start`);
    return lines.join('\n');
  }
  const lines = [];
  if (!existing) lines.push(`mkdir -p -- ${shellQuote(projectDir)}`, `cd -- ${shellQuote(projectDir)}`, 'git init', "git -c user.name=Tandem -c user.email=tandem@localhost commit --allow-empty -m 'Start'");
  else lines.push(`cd -- ${shellQuote(projectDir)}`);
  lines.push(`${shellQuote(tandem)} --start`);
  return lines.join('\n');
}

type Props = {
  tandemDir?: string;
  projectDir?: string;
  say: (message: string) => void;
  idPrefix: string;
};

export function ProjectStarter({ tandemDir = '', projectDir = '', say, idPrefix }: Props) {
  const windows = isWindowsPath(tandemDir) || isWindowsPath(projectDir) || navigator.userAgent.includes('Windows');
  const suggestedTandem = tandemDir || (windows ? 'C:\\Code\\tandem' : '/path/to/tandem');
  const base = parentFolder(projectDir) || (windows ? 'C:\\Code' : '/path/to');
  const suggestedProject = withChild(base, 'tandem-test');
  const [tandemFolder, setTandemFolder] = useState(suggestedTandem);
  const [newProjectFolder, setNewProjectFolder] = useState(suggestedProject);
  const [tandemEdited, setTandemEdited] = useState(false);
  const [projectEdited, setProjectEdited] = useState(false);
  const [existing, setExisting] = useState(false);

  // The connected team tells us its real folders a moment after the page first renders. Preserve
  // what the person typed, but otherwise replace the generic examples with those real folders.
  useEffect(() => { if (!tandemEdited) setTandemFolder(suggestedTandem); }, [suggestedTandem, tandemEdited]);
  useEffect(() => { if (!projectEdited) setNewProjectFolder(suggestedProject); }, [suggestedProject, projectEdited]);

  const ready = tandemFolder.trim().length > 0 && newProjectFolder.trim().length > 0;
  const code = ready ? starterCommand(tandemFolder.trim(), newProjectFolder.trim(), existing) : '';
  const projectLabel = existing ? 'Existing Git project folder' : 'New project folder';

  return (
    <section className="project-starter" aria-labelledby={`${idPrefix}-project-h`}>
      <h2 id={`${idPrefix}-project-h`}>Start a new project</h2>
      <p className="small muted">Tandem stays in its own folder. Choose where your project should live, and this gives you one exact terminal block to create it and start the team.</p>
      <div className="form project-starter-form">
        <div className="row2">
          <label htmlFor={`${idPrefix}-tandem`}>Tandem folder
            <input id={`${idPrefix}-tandem`} value={tandemFolder} onChange={e => { setTandemEdited(true); setTandemFolder(e.target.value); }} placeholder={windows ? 'C:\\Code\\tandem' : '/path/to/tandem'} />
          </label>
          <label htmlFor={`${idPrefix}-project`}>{projectLabel}
            <input id={`${idPrefix}-project`} value={newProjectFolder} onChange={e => { setProjectEdited(true); setNewProjectFolder(e.target.value); }} placeholder={windows ? 'C:\\Code\\tandem-test' : '/path/to/tandem-test'} />
          </label>
        </div>
        <label className="check-row" htmlFor={`${idPrefix}-existing`}>
          <input id={`${idPrefix}-existing`} type="checkbox" checked={existing} onChange={e => setExisting(e.target.checked)} />
          This folder already contains a Git project
        </label>
      </div>
      {ready
        ? <>
          <p className="small"><strong>{existing ? 'Start the existing project' : 'Create the project and start Tandem'}</strong> <span className="muted">Copy this into PowerShell or Terminal. The browser cannot run local commands itself.</span></p>
          <CodeLine code={code} say={say} />
          {!existing && <p className="small muted">This creates the folder, initializes Git, and makes the first empty commit Tandem needs. It does not put Tandem files inside your project.</p>}
        </>
        : <p className="small warn">Enter the Tandem folder and project folder to make the command.</p>}
    </section>
  );
}
