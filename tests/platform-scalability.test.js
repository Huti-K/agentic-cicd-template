import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../worker/db.js';
import { createApp } from '../worker/index.js';
import { GitHub } from '../worker/github.js';
import { platformHarness, REPO, PR_SHA, BASE_SHA } from './helpers/platform-harness.js';

test('concurrent ticket linking creates one issue and recovers a lost local result by exact marker', async context => {
  const api = await platformHarness(context);await api.signIn();
  api.env.GITHUB_TOKEN = '';
  const ticket = (await api.createTicket()).data.ticket;
  api.env.GITHUB_TOKEN = 'fixture';
  const remote = [], original = api.github.fetcher;let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  context.after(() => release());
  const app = createApp({ fetcher: async (url, options) => {
    if (url.endsWith('/issues') && options.method === 'POST') {
      remote.push({ number: 321, ...JSON.parse(options.body) });entered();if(remote.length>1)release();await gate;
      return Response.json(remote.at(-1));
    }
    if (url.includes('/issues?')) return Response.json(remote);
    return original(url, options);
  } });
  const request = () => app.fetch(new Request('https://relay.test/api/tickets/'+ticket.id+'/actions', { method: 'POST', headers: { Origin: 'https://relay.test', Cookie: api.cookie, 'X-CSRF-Token': api.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'triage' }) }), api.env);
  const first = request();await waiting;
  const second = request();
  await Promise.race([first,second]);release();
  const responses = await Promise.all([first, second]);
  assert.equal(remote.length, 1);
  assert.ok(responses.some(response => response.status === 200));
  const store = new Store(api.DB), current = await store.ticket(ticket.id);
  assert.equal(current.issueNumber, 321);
  await store.pauseTicket(current);
  await store.update(await store.ticket(ticket.id), { issueNumber: null, issueUrl: null, status: 'new' });
  await api.DB.prepare("UPDATE metadata SET value=json_set(value,'$.until',0) WHERE key=?").bind('issue-link:'+ticket.id).run();
  assert.equal((await request()).status, 200);
  assert.equal(remote.length, 1, 'retry must recover the remote issue after a lost local association');
  assert.equal((await store.ticket(ticket.id)).issueNumber, 321);
});

test('all tickets remain pageable and deployment updates older merged tickets', async context => {
  const api = await platformHarness(context), store = new Store(api.DB);
  const base = { title: 'Newer support request', description: 'Fictional request', type: 'task', priority: 'medium', status: 'deployed', tags: [], contributorIds: [], activeJobId: null };
  await api.DB.batch(Array.from({ length: 207 }, (_, index) => api.DB.prepare('INSERT INTO tickets(data,created_at,updated_at) VALUES(?,?,?)').bind(JSON.stringify({ ...base, ...(index === 0 ? { title: 'Ancient exact needle', status: 'merged', mergeCommitSha: PR_SHA } : index === 1 ? { title: 'Older attention request', status: 'new', priority: 'urgent' } : {}) }), '2026-10-01', '2026-10-01')));
  const workspace = await api.request('/api/workspace');
  assert.equal(workspace.data.ticketCounts.total, 207);
  assert.equal(workspace.data.ticketCounts.statuses.merged, 1);
  assert.equal(workspace.data.tickets.length, 50);
  assert.ok(workspace.data.attentionTickets.some(ticket => ticket.id === 'RLY-2'));
  const seen = [];let cursor = '';
  do { const page = await api.request('/api/tickets?limit=50'+(cursor?'&cursor='+cursor:''));assert.equal(page.status, 200);seen.push(...page.data.tickets.map(ticket => ticket.id));cursor = page.data.nextCursor; } while (cursor);
  assert.equal(new Set(seen).size, 207);
  const found = await api.request('/api/tickets?query=exact%20needle&status=merged');
  assert.equal(found.data.total, 1);assert.equal(found.data.tickets[0].id, 'RLY-1');
  assert.equal((await api.request('/api/tickets?limit=1000')).status, 400);
  const deployed = await api.request('/api/automation/deployment', { method: 'POST', authenticated: false, csrf: false, origin: null, headers: { Authorization: 'Bearer '+api.env.RELAY_CALLBACK_SECRET }, body: { sha: BASE_SHA, url: 'https://relay.test' } });
  assert.equal(deployed.status, 200);assert.equal((await store.ticket('RLY-1')).status, 'deployed');
});

test('remote issue success survives a failed local association without a second POST', async context => {
  const api = await platformHarness(context);await api.signIn();const database = api.env.DB;let fail = true;
  api.env.DB = new Proxy(database, { get(target,key) {
    if(key==='prepare')return sql => {
      const statement=target.prepare(sql);
      if(fail&&sql.startsWith("UPDATE tickets SET data=json_set(data,'$.issueNumber'"))return {bind(){return {run(){fail=false;throw new Error('Interrupted association write');}};}};
      return statement;
    };
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
  const created = await api.createTicket();assert.equal(created.status,201);assert.equal(created.data.ticket.issueNumber,null);
  assert.equal(api.github.issues.length,1);
  api.env.DB = database;
  await database.prepare("UPDATE metadata SET value=json_set(value,'$.until',0) WHERE key='issue-link:RLY-1'").run();
  api.github.failure={path:'/issues',status:403};
  assert.equal((await api.request('/api/tickets/RLY-1/actions',{method:'POST',body:{action:'triage'}})).status,503);
  const claim=JSON.parse((await database.prepare("SELECT value FROM metadata WHERE key='issue-link:RLY-1'").first()).value);
  assert.equal(claim.attempted,true,'a failed reconciliation read must never authorize another creation');
  api.github.failure=null;
  await database.prepare("UPDATE metadata SET value=json_set(value,'$.until',0) WHERE key='issue-link:RLY-1'").run();
  const recovered = await api.request('/api/tickets/RLY-1/actions',{method:'POST',body:{action:'triage'}});
  assert.equal(recovered.status,200);assert.equal(recovered.data.ticket.issueNumber,100);
  assert.equal(api.github.issues.length,1);
});

test('issue reconciliation pages REST history, ignores injected markers and rejects ambiguity',async context=>{
  const api=await platformHarness(context),github=new GitHub(api.env,api.github.fetcher),ticket={id:'RLY-1'},marker='server-generated-nonce';
  api.github.issues=Array.from({length:100},(_,index)=>({number:index+1,title:'Unrelated',body:'Other support request'}));
  const real={number:501,title:'[RLY-1] Actual ticket',body:'Trusted creation\n<!-- relay-ticket:'+marker+' -->'};
  api.github.issues.push({...real,number:400,pull_request:{}},{...real,number:401,body:real.body+'\n<!-- relay-ticket:other-nonce -->'},real);
  assert.equal((await github.findIssue(ticket,marker)).number,501);
  assert.equal(api.github.calls.filter(call=>call.path.endsWith('/issues')).length,2);
  api.github.issues.push({...real,number:502});
  await assert.rejects(github.findIssue(ticket,marker),error=>error.code==='issue_ambiguous');
});

test('a human pause or changed implementation request during issue linking cannot restart automation',async context=>{
  for(const change of ['pause','edit']){
    const api=await platformHarness(context);await api.signIn();api.env.GITHUB_TOKEN='';
    const store=new Store(api.DB),ticket=await store.update((await api.createTicket()).data.ticket,{triage:{ready:true}});api.env.GITHUB_TOKEN='fixture';
    let release,entered;const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{entered=resolve;});context.after(()=>release());
    const app=createApp({fetcher:async(url,options)=>{if(url.endsWith('/issues')&&options.method==='POST'){entered();await gate;}return api.github.fetcher(url,options);}});
    const pending=app.fetch(new Request('https://relay.test/api/tickets/RLY-1/actions',{method:'POST',headers:{Origin:'https://relay.test',Cookie:api.cookie,'X-CSRF-Token':api.csrfToken,'Content-Type':'application/json'},body:JSON.stringify({action:change==='pause'?'triage':'implement'})}),api.env);
    await waiting;
    if(change==='pause')assert.equal((await api.request('/api/tickets/RLY-1/actions',{method:'POST',body:{action:'human-edit'}})).status,200);
    else assert.equal((await api.request('/api/tickets/RLY-1',{method:'PATCH',body:{version:ticket.version,description:'A different request needs new triage.'}})).status,200);
    release();assert.equal((await pending).status,409);
    assert.equal((await store.jobs('RLY-1')).length,0);assert.equal(api.github.dispatches.length,0);
    assert.equal((await store.ticket('RLY-1')).status,change==='pause'?'human_edit':'new');
  }
});

test('public PR reads share a durable cache while approval fetches fresh checks', async context => {
  const api = await platformHarness(context);await api.signIn();api.env.GITHUB_PUBLIC_CACHE_SECONDS = '30';
  const store = new Store(api.DB), ticket = await store.update((await api.createTicket()).data.ticket, { status: 'in_review', prNumber: 71, headSha: PR_SHA });
  const job = await store.createJob(ticket, 'evidence', BASE_SHA);await store.updateJob(job, { status: 'succeeded', evidence: [{}] });
  const before = api.github.calls.length;
  const results = await Promise.all(Array.from({ length: 5 }, () => api.request('/api/tickets/RLY-1')));
  assert.ok(results.every(result => result.status === 200 && result.data.pullRequest));
  assert.equal(api.github.calls.length-before, 4);
  const cached = await api.request('/api/tickets/RLY-1');
  assert.equal(cached.data.pullRequest.freshness.cached, true);
  assert.ok(cached.data.pullRequest.freshness.fetchedAt);
  api.github.checks[0].conclusion = 'failure';
  assert.equal((await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'approve-merge', headSha: PR_SHA } })).status, 409);
  assert.equal(api.github.mergeCalls, 0);
  assert.ok(api.github.calls.length > before+4);
  assert.equal((await store.ticket(ticket.id)).status, 'in_review');
});
