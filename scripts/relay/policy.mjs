import { execFileSync } from 'node:child_process';

export const SHA = /^[a-f0-9]{40}$/;
export const KINDS = ['triage', 'implement', 'evidence'];
export function allowedPath(path, kind = 'implement') {
  if (typeof path !== 'string' || path.split('/').some(part => !part || part.startsWith('.')) || /[\\\x00-\x1f]/.test(path)) return false;
  if (/^e2e\/agent\/[A-Za-z0-9_/-]+\.spec\.js$/.test(path)) return true;
  return kind === 'implement' && /^(demo\/[A-Za-z0-9_/-]+\.(js|html|css)|tests\/demo\/[A-Za-z0-9_/-]+\.test\.js)$/.test(path);
}
export function validateEntries(entries, kind, bytes, { requireTests = true } = {}) {
  if (!['implement', 'evidence'].includes(kind)) throw new Error('Invalid patch kind.');
  if (!entries.length || entries.length > 30 || bytes > 200_000) throw new Error('Patch must contain 1–30 files and at most 200 KB.');
  for (const entry of entries) {
    if (!allowedPath(entry.path, kind)) throw new Error(`Forbidden agent path: ${entry.path}`);
    if (!['100644', '000000'].includes(entry.mode) || entry.binary) throw new Error(`Unsupported file: ${entry.path}`);
  }
  if (requireTests && !entries.some(entry => /^(tests\/demo\/.*\.test\.js|e2e\/agent\/.*\.spec\.js)$/.test(entry.path) && entry.mode !== '000000')) throw new Error('Agent changes require a behavioral test.');
  return entries;
}
export function validatePatch(kind, cwd = process.cwd()) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 2_000_000 });
  const raw = git(['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z']).split('\0').filter(Boolean);
  const patch = git(['diff', '--cached', '--binary']);
  if (patch.includes('GIT binary patch')) throw new Error('Binary patches are forbidden.');
  const entries = [];
  for (let index = 0; index < raw.length; index += 2) entries.push({ path: raw[index + 1], mode: raw[index].split(' ')[1] });
  validateEntries(entries, kind, Buffer.byteLength(patch));
  for (const entry of entries) if (entry.mode !== '000000' && /^(tests\/|e2e\/)/.test(entry.path)) validateTestSource(entry.path, git(['show', ':' + entry.path]));
  return entries;
}
export function validateTestSource(path, source) {
  if (/\b(?:test|it|describe|t)\s*\.\s*(?:skip|fixme|only)\s*\(|\bskip\s*:\s*true/.test(source)) throw new Error('Agent tests cannot be skipped or focused.');
  if (path.startsWith('e2e/agent/') && (!/\btest\s*\(/.test(source) || !/\bpage\s*\./.test(source) || !/\bexpect\s*\(/.test(source))) throw new Error('Evidence specs need real browser interactions and assertions.');
}
const text = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
export function validateTriage(result, paths) {
  const known = new Set(paths);
  if (!result || !text(result.summary, 1500) || !text(result.description, 10000) || typeof result.ready !== 'boolean'
    || !Array.isArray(result.acceptanceCriteria) || result.acceptanceCriteria.length < 1 || result.acceptanceCriteria.length > 12
    || result.acceptanceCriteria.some(item => !text(item, 800))) throw new Error('Invalid triage description or acceptance criteria.');
  const references = {};
  for (const key of ['files', 'documentation']) {
    if (!Array.isArray(result[key]) || result[key].length > 12) throw new Error('Invalid triage references.');
    references[key] = result[key].map(reference => {
      // The agent also reads the trusted checkout. Store repository paths, never runner-local aliases.
      const path = typeof reference?.path === 'string' ? reference.path.replace(/^\.relay-trusted\//, '') : undefined;
      if (!known.has(path) || !text(reference.reason, 600)) throw new Error('Triage references must name actual repository files.');
      return { path, reason: reference.reason };
    });
  }
  return { summary: result.summary, description: result.description, acceptanceCriteria: result.acceptanceCriteria, ...references, ready: result.ready };
}
export function validateSnapshot(value, expected) {
  if (!value || value.repository !== expected.repository || !value.job || !value.ticket
    || value.job.id !== expected.jobId || value.job.ticketId !== expected.ticketId || value.ticket.id !== expected.ticketId
    || !/^RLY-[1-9][0-9]*$/.test(value.ticket.id) || value.job.kind !== expected.kind || !KINDS.includes(value.job.kind)
    || !['queued', 'running'].includes(value.job.status) || !SHA.test(value.baseSha)
    || value.branch !== 'relay/ticket-' + value.ticket.id) throw new Error('Invalid, stale, or mismatched automation job.');
  if (value.ticket.prNumber != null && (!Number.isSafeInteger(value.ticket.prNumber) || value.ticket.prNumber < 1 || !SHA.test(value.ticket.headSha))) throw new Error('Invalid linked PR.');
  if (expected.kind === 'evidence' && (!value.ticket.prNumber || value.job.headSha !== value.ticket.headSha)) throw new Error('Evidence requires an exact current PR head.');
  if (value.job.headSha && value.job.headSha !== value.ticket.headSha) throw new Error('The job was queued for an older PR head.');
  return value;
}
export function assertCurrentPr(pr, snapshot) {
  if (pr.state !== 'open' || pr.draft || pr.head?.repo?.full_name !== snapshot.repository
    || pr.head.ref !== snapshot.branch || pr.head.sha !== snapshot.ticket.headSha) throw new Error('The PR changed or closed while the agent was working.');
  return pr;
}
export function evidenceSummary(report) {
  if (!report || !report.stats || !Number.isSafeInteger(report.stats.expected) || report.stats.expected < 1
    || report.stats.unexpected !== 0 || report.stats.flaky !== 0 || report.stats.skipped !== 0
    || !Number.isFinite(report.stats.duration) || report.stats.duration < 0) throw new Error('Evidence must contain passing, non-skipped browser scenarios.');
  return { passed: report.stats.expected, failed: report.stats.unexpected, skipped: report.stats.skipped, duration: report.stats.duration };
}
