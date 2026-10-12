export const STATUS = { new:'New', triaging:'Triaging', ready:'Ready to build', implementing:'Implementing', in_review:'In review', human_edit:'Human editing', merged:'Merged', deployed:'Deployed', failed:'Needs attention' };
export const PRIORITY = { urgent:'Urgent', high:'High', medium:'Medium', low:'Low' };

export function descriptionCounterText(value, maximum) {
  const used = value.length;
  const format = count => count.toLocaleString('en-US');
  return `${format(used)} of ${format(maximum)} characters used · ${format(Math.max(0, maximum - used))} remaining`;
}

export function safeURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function sourceURL(repository, path, revision = 'main') {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !path || path.split('/').some(p => p === '..' || p === '.')) return null;
  return 'https://github.com/' + repository + '/blob/' + encodeURIComponent(revision) + '/' + path.split('/').map(encodeURIComponent).join('/');
}
export function mentionAt(text, caret) {
  const match = text.slice(0, caret).match(/(?:^|[^A-Za-z0-9_@.+-])@([a-zA-Z0-9_-]*)$/);
  return match ? { query:match[1].toLowerCase(), start:caret-match[1].length-1, end:caret } : null;
}
export function mentionParts(text, handles) {
  const source=String(text||''), known=new Set(handles.map(handle=>handle.toLowerCase())), parts=[];
  let end=0;
  for(const match of source.matchAll(/(^|[^A-Za-z0-9_@.+-])@([A-Za-z0-9_-]+)(?![A-Za-z0-9_-])/g)) {
    if(!known.has(match[2].toLowerCase()))continue;
    const start=match.index+match[1].length;
    if(start>end)parts.push({text:source.slice(end,start)});
    end=start+match[2].length+1;parts.push({text:source.slice(start,end),handle:match[2].toLowerCase()});
  }
  if(end<source.length)parts.push({text:source.slice(end)});
  return parts;
}
export function insertMention(text, mention, handle) {
  const prefix = text.slice(0,mention.start) + '@' + handle + ' ';
  return { text:prefix + text.slice(mention.end), caret:prefix.length };
}
export function filterTickets(tickets, { query='', status='', priority='' } = {}) {
  const needle = query.trim().toLowerCase();
  return tickets.filter(t => (!status || t.status === status) && (!priority || t.priority === priority) &&
    (!needle || [t.id,t.title,t.description,...(t.tags || [])].join(' ').toLowerCase().includes(needle)));
}
export function requestNeedsImplementation(ticket) {
  return !!ticket?.prNumber && (ticket.requestRevision || 0) !== (ticket.implementedRequestRevision || 0);
}
export function mergeReadiness(detail) {
  const pr = detail?.pullRequest;
  if (!pr) return { ready:false, reason:'An implementation pull request is required.' };
  if (pr.state !== 'open') return { ready:false, reason:'This pull request is no longer open.' };
  if (requestNeedsImplementation(detail.ticket)) return { ready:false, reason:'The updated request needs a new implementation before evidence and approval.' };
  if (detail.ticket?.pendingAgent) return { ready:false, reason:'The saved request must be handled before this revision can be approved.' };
  if (!pr.checksReady) return { ready:false, reason:'Waiting for passing checks on the current revision.' };
  if (!pr.evidenceReady) return { ready:false, reason:'Run the evidence agent for this revision before merging.' };
  if (!pr.canMerge) return { ready:false, reason:'An approved independent review and a mergeable revision are required.' };
  if (!/^[a-f0-9]{40}$/i.test(pr.headSha || '')) return { ready:false, reason:'The current revision could not be verified.' };
  return { ready:true, reason:'Checks, independent review, and evidence are ready. A maintainer can approve this revision.' };
}
export function createAPI({ fetcher = globalThis.fetch, csrf = () => '' } = {}) {
  return async function request(path, { method='GET', body, signal } = {}) {
    if (!path.startsWith('/api/')) throw new Error('Only same-origin platform requests are allowed.');
    const headers = { Accept:'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRF-Token'] = csrf() || '';
    const response = await fetcher(path,{ method, headers, credentials:'same-origin', cache:'no-store', signal, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
    let data;
    try { data = await response.json(); } catch { throw new Error('The platform returned an unreadable response. Please try again.'); }
    if (!response.ok) { const error = new Error(data.error || 'The request could not be completed.'); error.status=response.status; error.code=data.code; throw error; }
    return data;
  };
}
