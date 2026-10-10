import { execFileSync } from 'node:child_process';

export function allowedPath(file) {
  if (file.split('/').some((part) => part === '..' || part.startsWith('.'))) return false;
  return /^(demo\/[a-zA-Z0-9_/-]+\.(js|html|css)|tests\/demo\/[a-zA-Z0-9_/-]+\.test\.js)$/.test(file);
}

export function validatePatch() {
  const changes = execFileSync('git', ['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z']).toString().split('\0').filter(Boolean);
  if (!changes.length) throw new Error('Codex produced no changes.');
  if (changes.length > 60) throw new Error('Patch exceeds the 30-file limit.');
  for (let i = 0; i < changes.length; i += 2) {
    const metadata = changes[i].split(' ');
    const path = changes[i + 1];
    if (!allowedPath(path)) throw new Error(`Agent patch may not modify ${path}`);
    if (!['100644', '000000'].includes(metadata[1])) throw new Error(`Symlinks or executables are not allowed: ${path}`);
  }
  const patch = execFileSync('git', ['diff', '--cached', '--binary']);
  if (patch.length > 200_000) throw new Error('Patch exceeds 200 KB.');
  if (patch.includes(Buffer.from('GIT binary patch'))) throw new Error('Binary patches are not allowed.');
  console.log(`Validated ${changes.length / 2} changed files.`);
}

if (process.argv[1]?.endsWith('/validate-patch.mjs')) validatePatch();
