// Tandem's command is a TypeScript file that Node runs directly, which needs Node 22.18 or newer.
// This is plain JavaScript so even an old Node can run it and say what is wrong.
export const MIN = [22, 18];

export function tooOld(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  return major < MIN[0] || (major === MIN[0] && minor < MIN[1]);
}

export function oldNodeMessage(version = process.versions.node) {
  return `Tandem needs Node.js ${MIN.join('.')} or newer. This computer has ${version}.\n` +
    '  Install the current LTS from https://nodejs.org (the installer replaces the old one),\n' +
    '  or on Windows: winget install OpenJS.NodeJS.LTS\n' +
    '  Then open a NEW terminal and check: node --version';
}
