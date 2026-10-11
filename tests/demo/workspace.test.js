import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../../demo/src/seed.js';
import { createTicket, updateTicket, createPullRequest, runChecks, reviewPullRequest, applySuggestedFix, mergePullRequest, filterTickets, metrics, validateWorkspace, loadWorkspace, saveWorkspace, STORAGE_KEY } from '../../demo/src/workspace.js';
const now = '2026-10-11T12:00:00.000Z';
const input = { projectId: 'orbit', title: 'A new ticket', description: 'Useful context', status: 'todo', priority: 'medium', assigneeId: 'alex', dueDate: '' };

test('sample workspace has valid links and accurate totals', () => {
  const state = createSeed(now);
  assert.equal(validateWorkspace(state), true);
  assert.deepEqual(metrics(state), { open: 15, review: 3, merged: 4, done: 5, projects: 4 });
});
test('new tickets receive unique project identifiers without mutating the original', () => {
  const state = createSeed(now), before = structuredClone(state);
  const first = createTicket(state,input,now);
  const second = createTicket(first.state,input,now);
  assert.equal(first.id,'ORB-143'); assert.equal(second.id,'ORB-144');
  assert.deepEqual(state,before);
  assert.equal(validateWorkspace(second.state),true);
});
test('invalid titles, dates, projects and assignees are rejected without mutation', () => {
  const state = createSeed(now), before = structuredClone(state);
  for (const change of [{title:'  '},{title:'x'.repeat(121)},{dueDate:'2026-02-31'},{projectId:'missing'},{assigneeId:'missing'},{status:'__proto__'}]) {
    assert.throws(() => createTicket(state,{...input,...change},now));
    assert.deepEqual(state,before);
  }
});
test('filters combine project, status, priority and case-insensitive query', () => {
  const state = createSeed(now);
  const result = filterTickets(state,{projectId:'orbit',status:'in_review',priority:'high',query:'DISCOUNT'});
  assert.deepEqual(result.map(t=>t.id),['ORB-142']);
  assert.equal(filterTickets(state,{query:'no such ticket'}).length,0);
  assert.deepEqual(filterTickets(state,{query:'ATL-086'}).map(t=>t.id),['ATL-086']);
});
test('tickets with open pull requests cannot be completed or moved across projects', () => {
  const state = createSeed(now), before = structuredClone(state);
  assert.throws(() => updateTicket(state,'ORB-142',{status:'done'},now),/Merge the linked/);
  assert.throws(() => updateTicket(state,'ORB-142',{projectId:'atlas'},now),/original project/);
  assert.deepEqual(state,before);
});
test('PR creation links the same project and rejects duplicates', () => {
  const state = createSeed(now);
  const created = createPullRequest(state,'ORB-140',now);
  const pr = created.state.pullRequests.find(p=>p.id===created.id);
  assert.equal(pr.projectId,'orbit'); assert.equal(pr.ticketId,'ORB-140');
  assert.equal(created.state.tickets.find(t=>t.id==='ORB-140').status,'in_review');
  assert.throws(() => createPullRequest(created.state,'ORB-140',now),/already has/);
  assert.throws(() => createPullRequest(state,'ORB-138',now),/Reopen/);
  assert.equal(validateWorkspace(created.state),true);
});
test('a failing PR needs a fix, fresh checks and review before merge', () => {
  let state = createSeed(now);
  const before = structuredClone(state), id = 'pr-atlas-56';
  assert.throws(() => mergePullRequest(state,id,now),/required/);
  assert.deepEqual(state,before);
  state = reviewPullRequest(state,id,now);
  assert.equal(state.pullRequests.find(p=>p.id===id).review,'changes_requested');
  state = applySuggestedFix(state,id,now);
  assert.equal(state.pullRequests.find(p=>p.id===id).review,'pending');
  assert.equal(state.pullRequests.find(p=>p.id===id).checks,'pending');
  assert.throws(() => mergePullRequest(state,id,now),/required/);
  state = runChecks(state,id,now);
  assert.throws(() => mergePullRequest(state,id,now),/required/);
  state = reviewPullRequest(state,id,now);
  state = mergePullRequest(state,id,now);
  assert.equal(state.pullRequests.find(p=>p.id===id).state,'merged');
  assert.equal(state.tickets.find(t=>t.id==='ATL-086').status,'done');
  assert.equal(state.tickets.find(t=>t.id==='ORB-142').status,'in_review');
  assert.equal(validateWorkspace(state),true);
  assert.throws(() => mergePullRequest(state,id,now),/already merged/);
});
test('passing checks do not override an actionable review finding', () => {
  const state = createSeed(now);
  assert.equal(state.pullRequests.find(p=>p.id==='pr-orbit-89').checks,'passed');
  assert.throws(() => mergePullRequest(state,'pr-orbit-89',now),/required/);
});
test('valid local data survives a save and reload; corrupt data recovers', () => {
  let value = null;
  const storage = { getItem: key => key === STORAGE_KEY ? value : null, setItem: (key,data) => { value=data; } };
  const state = createTicket(createSeed(now),input,now).state;
  assert.equal(saveWorkspace(storage,state),true);
  assert.deepEqual(loadWorkspace(storage,now).state,state);
  value = '{broken';
  assert.equal(loadWorkspace(storage,now).reason,'recovered');
  value = JSON.stringify({...state,version:99});
  assert.equal(loadWorkspace(storage,now).reason,'recovered');
  const badLink = structuredClone(state);
  badLink.pullRequests[0].projectId = 'atlas';
  value = JSON.stringify(badLink);
  assert.equal(loadWorkspace(storage,now).reason,'recovered');
});
test('unavailable storage never loses the in-memory workspace', () => {
  const storage = { getItem() {throw new Error('denied');}, setItem() {throw new Error('quota');} };
  const state = createSeed(now), before=structuredClone(state);
  assert.equal(saveWorkspace(storage,state),false);
  assert.deepEqual(state,before);
  assert.equal(validateWorkspace(loadWorkspace(storage,now).state),true);
});
test('saved counters cannot reuse existing activity identifiers or exceed safe integers', () => {
  const state = createSeed(now);
  state.nextEvent = 6;
  assert.equal(validateWorkspace(state),false);
  state.nextEvent = Number.MAX_SAFE_INTEGER;
  assert.equal(validateWorkspace(state),false);
});
