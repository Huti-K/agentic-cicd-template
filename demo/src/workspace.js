import { createSeed } from './seed.js';

export const STATUSES = { backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', in_review: 'In review', done: 'Done' };
export const PRIORITIES = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
export const STORAGE_KEY = 'relay.workspace.v1';
const colors = ['violet', 'blue', 'orange', 'pink', 'green'];
const text = (value, max) => typeof value === 'string' && value.length <= max;
const required = (value, max) => text(value, max) && value.trim().length > 0;
const timestamp = value => text(value, 40) && Number.isFinite(Date.parse(value));
const unique = list => new Set(list.map(item => item.id)).size === list.length;
const member = (object, key) => typeof key === 'string' && Object.hasOwn(object, key);
const dateOnly = value => value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);

export function validateWorkspace(state) {
  try {
    if (!state || state.version !== 1 || !Number.isSafeInteger(state.nextEvent) || state.nextEvent < 1 || state.nextEvent >= Number.MAX_SAFE_INTEGER) return false;
    for (const [key, limit] of [['projects',25],['people',100],['tickets',500],['pullRequests',500],['activity',80]]) {
      if (!Array.isArray(state[key]) || state[key].length > limit || !state[key].every(item => item && typeof item === 'object') || !unique(state[key])) return false;
    }
    if (!state.projects.length || !state.people.length) return false;
    if (state.activity.some(event => !/^event-[1-9][0-9]*$/.test(event.id) || Number(event.id.slice(6)) >= state.nextEvent)) return false;
    const people = new Set(state.people.map(person => person.id));
    if (state.people.some(p => !/^[a-z][a-z0-9-]*$/.test(p.id) || !required(p.name,80) || !required(p.initials,3) || !colors.includes(p.color))) return false;
    if (state.projects.some(p => !/^[a-z][a-z0-9-]*$/.test(p.id) || !/^[A-Z]{2,6}$/.test(p.code) || !required(p.name,80) || !text(p.description,300) || !required(p.repository,100) || !colors.includes(p.color) || !people.has(p.leadId))) return false;
    if (new Set(state.projects.map(p => p.code)).size !== state.projects.length) return false;
    const projects = new Map(state.projects.map(p => [p.id,p]));
    if (state.tickets.some(t => !projects.has(t.projectId) || !new RegExp('^' + projects.get(t.projectId).code + '-[0-9]{1,6}$').test(t.id)
      || !required(t.title,120) || !text(t.description,2000) || !member(STATUSES,t.status) || !member(PRIORITIES,t.priority)
      || !(t.assigneeId === '' || people.has(t.assigneeId)) || !text(t.dueDate,10) || !dateOnly(t.dueDate)
      || !Array.isArray(t.labels) || t.labels.length > 5 || t.labels.some(label => !required(label,30)) || !timestamp(t.createdAt) || !timestamp(t.updatedAt))) return false;
    const tickets = new Map(state.tickets.map(t => [t.id,t]));
    if (state.pullRequests.some(pr => !required(pr.id,80) || !tickets.has(pr.ticketId) || pr.projectId !== tickets.get(pr.ticketId).projectId
      || !Number.isSafeInteger(pr.number) || pr.number < 1 || !required(pr.title,140) || !required(pr.branch,160) || !people.has(pr.authorId)
      || !['open','merged'].includes(pr.state) || !['pending','passed','failed'].includes(pr.checks) || !['pending','approved','changes_requested'].includes(pr.review)
      || typeof pr.checkFailure !== 'boolean' || ![pr.files,pr.additions,pr.deletions].every(value => Number.isSafeInteger(value) && value >= 0)
      || !timestamp(pr.updatedAt) || (pr.issue !== null && (!pr.issue || !['P1','P2'].includes(pr.issue.severity) || !required(pr.issue.path,200) || !required(pr.issue.message,1000) || !Number.isSafeInteger(pr.issue.line) || pr.issue.line < 1))
      || (pr.state === 'merged' && (pr.checks !== 'passed' || pr.review !== 'approved' || pr.issue || pr.checkFailure)))) return false;
    if (new Set(state.pullRequests.map(pr => pr.projectId + ':' + pr.number)).size !== state.pullRequests.length) return false;
    const prs = new Set(state.pullRequests.map(pr => pr.id));
    if (state.activity.some(event => !required(event.id,80) || !(event.actorId === 'agent' || people.has(event.actorId)) || !required(event.message,300)
      || !timestamp(event.at) || !(event.targetType === 'ticket' ? tickets.has(event.targetId) : event.targetType === 'pr' && prs.has(event.targetId)))) return false;
    return true;
  } catch { return false; }
}
function ensure(state) {
  if (!validateWorkspace(state)) throw new Error('This workspace data is invalid. Reset the demo to continue.');
}
function addEvent(state, message, targetType, targetId, now, actorId = 'alex') {
  // Pick an existing person even when a valid imported workspace has different people.
  const actor = actorId === 'agent' ? 'agent' : state.people.find(p => p.id === actorId)?.id || state.people[0].id;
  state.activity.unshift({ id: 'event-' + state.nextEvent++, actorId: actor, message, targetType, targetId, at: now });
  state.activity = state.activity.slice(0, 80);
}
function ticketData(state, input) {
  if (!state.projects.some(p => p.id === input.projectId)) throw new Error('Choose a valid project.');
  if (!required(input.title,120)) throw new Error('Add a ticket title of 1–120 characters.');
  if (!text(input.description ?? '',2000)) throw new Error('Keep the description under 2,000 characters.');
  if (!member(STATUSES,input.status)) throw new Error('Choose a valid status.');
  if (!member(PRIORITIES,input.priority)) throw new Error('Choose a valid priority.');
  if (!(input.assigneeId === '' || state.people.some(p => p.id === input.assigneeId))) throw new Error('Choose a valid assignee.');
  if (!text(input.dueDate ?? '',10) || !dateOnly(input.dueDate ?? '')) throw new Error('Choose a valid due date.');
  return { projectId: input.projectId, title: input.title.trim(), description: (input.description ?? '').trim(), status: input.status,
    priority: input.priority, assigneeId: input.assigneeId, dueDate: input.dueDate ?? '' };
}
export function createTicket(state, input, now = new Date().toISOString()) {
  ensure(state);
  if (state.tickets.length >= 500) throw new Error('This demo has reached 500 tickets. Reset the sample data to start fresh.');
  const data = ticketData(state, input);
  const project = state.projects.find(p => p.id === data.projectId);
  const number = Math.max(0,...state.tickets.filter(t => t.projectId === project.id).map(t => Number(t.id.split('-').at(-1)))) + 1;
  if (number > 999999) throw new Error('This project has reached its ticket limit.');
  const id = project.code + '-' + number;
  const next = structuredClone(state);
  next.tickets.unshift({ ...data, id, labels: [], createdAt: now, updatedAt: now });
  addEvent(next, 'Created ' + id + ': ' + data.title, 'ticket', id, now);
  return { state: next, id };
}
export function updateTicket(state, id, changes, now = new Date().toISOString()) {
  ensure(state);
  const current = state.tickets.find(t => t.id === id);
  if (!current) throw new Error('Ticket not found.');
  const data = ticketData(state, { ...current, ...changes });
  if (data.projectId !== current.projectId) throw new Error('A ticket must stay in its original project.');
  if (data.status === 'done' && state.pullRequests.some(pr => pr.ticketId === id && pr.state === 'open')) throw new Error('Merge the linked pull request before completing this ticket.');
  const next = structuredClone(state);
  Object.assign(next.tickets.find(t => t.id === id), data, { updatedAt: now });
  addEvent(next, current.status === data.status ? 'Updated ' + id : 'Moved ' + id + ' to ' + STATUSES[data.status].toLowerCase(), 'ticket', id, now);
  return next;
}
export function createPullRequest(state, ticketId, now = new Date().toISOString()) {
  ensure(state);
  const ticket = state.tickets.find(t => t.id === ticketId);
  if (!ticket) throw new Error('Ticket not found.');
  if (ticket.status === 'done') throw new Error('Reopen this ticket before creating a pull request.');
  if (state.pullRequests.some(pr => pr.ticketId === ticketId && pr.state === 'open')) throw new Error('This ticket already has an open pull request.');
  if (state.pullRequests.length >= 500) throw new Error('This demo has reached its pull request limit.');
  const number = Math.max(0,...state.pullRequests.filter(pr => pr.projectId === ticket.projectId).map(pr => pr.number)) + 1;
  if (!Number.isSafeInteger(number)) throw new Error('This project has reached its pull request limit.');
  const id = 'pr-' + ticket.projectId + '-' + number;
  const next = structuredClone(state);
  next.pullRequests.unshift({ id, number, projectId: ticket.projectId, ticketId, title: ticket.title, branch: 'work/' + ticketId.toLowerCase(),
    authorId: ticket.assigneeId || state.people[0].id, state: 'open', checks: 'pending', review: 'pending', issue: null, checkFailure: false,
    files: 3, additions: 48, deletions: 12, updatedAt: now });
  const linked = next.tickets.find(t => t.id === ticketId);
  linked.status = 'in_review'; linked.updatedAt = now;
  addEvent(next, 'Opened PR #' + number + ' for ' + ticketId, 'pr', id, now);
  return { state: next, id };
}
function changePullRequest(state, id, action, now) {
  ensure(state);
  const current = state.pullRequests.find(pr => pr.id === id);
  if (!current) throw new Error('Pull request not found.');
  if (current.state !== 'open') throw new Error('This pull request is already merged.');
  const next = structuredClone(state);
  const pr = next.pullRequests.find(item => item.id === id);
  action(pr, next);
  pr.updatedAt = now;
  return next;
}
export function runChecks(state, id, now = new Date().toISOString()) {
  return changePullRequest(state,id,(pr,next) => {
    pr.checks = pr.checkFailure ? 'failed' : 'passed';
    addEvent(next, 'Demo checks ' + pr.checks + ' on PR #' + pr.number, 'pr', id, now, 'agent');
  },now);
}
export function reviewPullRequest(state, id, now = new Date().toISOString()) {
  return changePullRequest(state,id,(pr,next) => {
    pr.review = pr.issue ? 'changes_requested' : 'approved';
    addEvent(next, 'Demo agent ' + (pr.issue ? 'requested changes on' : 'approved') + ' PR #' + pr.number, 'pr', id, now, 'agent');
  },now);
}
export function applySuggestedFix(state, id, now = new Date().toISOString()) {
  return changePullRequest(state,id,(pr,next) => {
    if (!pr.issue && !pr.checkFailure) throw new Error('There is no suggested fix to apply.');
    pr.issue = null; pr.checkFailure = false; pr.checks = 'pending'; pr.review = 'pending';
    addEvent(next, 'Applied a demo fix to PR #' + pr.number + '; checks and review need rerunning', 'pr', id, now);
  },now);
}
export function mergePullRequest(state, id, now = new Date().toISOString()) {
  return changePullRequest(state,id,(pr,next) => {
    if (pr.checks !== 'passed' || pr.review !== 'approved' || pr.issue || pr.checkFailure) throw new Error('Passing checks and an approved review are required to merge.');
    pr.state = 'merged';
    const ticket = next.tickets.find(t => t.id === pr.ticketId);
    if (!next.pullRequests.some(item => item.ticketId === ticket.id && item.state === 'open')) ticket.status = 'done';
    ticket.updatedAt = now;
    addEvent(next, 'Merged PR #' + pr.number + ' for ' + ticket.id, 'pr', id, now);
  },now);
}
export function filterTickets(state, { query = '', projectId = '', status = '', priority = '', assigneeId = '' } = {}) {
  const term = query.trim().toLowerCase();
  return state.tickets.filter(ticket => (!term || [ticket.id,ticket.title,ticket.description,...ticket.labels].join(' ').toLowerCase().includes(term))
    && (!projectId || ticket.projectId === projectId) && (!status || ticket.status === status)
    && (!priority || ticket.priority === priority) && (!assigneeId || ticket.assigneeId === assigneeId));
}
export function metrics(state) {
  return { open: state.tickets.filter(t => t.status !== 'done').length,
    review: state.pullRequests.filter(pr => pr.state === 'open' && pr.review !== 'approved').length,
    merged: state.pullRequests.filter(pr => pr.state === 'merged').length,
    done: state.tickets.filter(t => t.status === 'done').length,
    projects: state.projects.length };
}
export function loadWorkspace(storage, now) {
  try {
    if (!storage) return { state: createSeed(now), reason: 'unavailable' };
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return { state: createSeed(now), reason: null };
    if (raw.length > 2_000_000) throw new Error('Workspace is too large');
    const state = JSON.parse(raw);
    if (!validateWorkspace(state)) throw new Error('Invalid workspace');
    return { state, reason: null };
  } catch { return { state: createSeed(now), reason: 'recovered' }; }
}
export function saveWorkspace(storage, state) {
  ensure(state);
  try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}
