import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIssue } from '../scripts/workflow/issue.cjs';
import { allowedPath } from '../scripts/workflow/validate-patch.mjs';

test('empty forms cannot start paid agent work', () => {
  assert.equal(validateIssue('').length, 4);
  assert.deepEqual(validateIssue('### What happened\n_No response_'), ['What happened', 'Steps to reproduce', 'Expected behavior', 'Acceptance criteria']);
});
test('a complete bug report passes the structural gate', () => {
  assert.deepEqual(validateIssue(['What happened', 'Steps to reproduce', 'Expected behavior', 'Acceptance criteria'].map((x) => `### ${x}\nSpecific testable behavior here.`).join('\n')), []);
});
test('bug reports with Windows line endings still pass the structural gate', () => {
  const body = ['What happened', 'Steps to reproduce', 'Expected behavior', 'Acceptance criteria'].map((x) => `### ${x}\r\nSpecific testable behavior here.`).join('\r\n');
  assert.deepEqual(validateIssue(body), []);
});
test('agent publication allows demo changes but never automation or hidden configuration', () => {
  for (const file of ['demo/src/workspace.js', 'demo/index.html', 'tests/demo/merge-guard.test.js']) assert.equal(allowedPath(file), true, file);
  for (const file of ['.github/workflows/ci.yml', 'package.json', 'AGENTS.md', 'scripts/build.mjs', 'demo/../scripts/evil.js', 'demo/.codex/config.js', 'demo/script.sh', 'demo/a\\b.js', 'tests/workflow.test.js']) assert.equal(allowedPath(file), false, file);
});
