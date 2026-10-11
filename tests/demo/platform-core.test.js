import test from 'node:test';
import assert from 'node:assert/strict';
import { safeURL, sourceURL, mentionAt, mentionParts, insertMention, filterTickets, mergeReadiness, createAPI } from '../../demo/src/platform-core.js';

test('mentions match the caret token, never email addresses, and preserve surrounding text', () => {
  assert.equal(mentionAt('support@example.com',19),null);
  assert.equal(mentionAt('Hi @david please',16),null);
  const token=mentionAt('Hello @da please',9);
  assert.deepEqual(token,{query:'da',start:6,end:9});
  assert.deepEqual(insertMention('Hello @da please',token,'davidmikan'),{text:'Hello @davidmikan  please',caret:18});
  assert.deepEqual(mentionAt('@',1),{query:'',start:0,end:1});
});
test('mention rendering recognizes complete handles and punctuation without highlighting email', () => {
  assert.deepEqual(mentionAt('(@da',4),{query:'da',start:1,end:4});
  const parts=mentionParts('mail@ai.example (@ai), @huti and @unknown.',['ai','huti']);
  assert.deepEqual(parts.filter(part=>part.handle).map(part=>part.handle),['ai','huti']);
  assert.equal(parts.map(part=>part.text).join(''),'mail@ai.example (@ai), @huti and @unknown.');
  assert.deepEqual(mentionParts('someone@ai',['ai']),[{text:'someone@ai'}]);
});
test('external and repository links reject unsafe schemes and traversal', () => {
  assert.equal(safeURL('javascript:alert(1)'),null);
  assert.equal(safeURL('data:text/html,bad'),null);
  assert.equal(safeURL('https://user:password@example.com'),null);
  assert.equal(safeURL('https://github.com/a/b'),'https://github.com/a/b');
  assert.equal(sourceURL('owner/repo','../secret'),null);
  assert.equal(sourceURL('owner/repo','demo/a file.js','feature/test'),'https://github.com/owner/repo/blob/feature%2Ftest/demo/a%20file.js');
});
test('ticket search combines status, priority, tags and identifiers without mutation', () => {
  const tickets=[{id:'RLY-1',title:'Offline mode',tags:['mobile'],status:'ready',priority:'high'},{id:'RLY-2',title:'Second',tags:[],status:'new',priority:'low'}];
  assert.deepEqual(filterTickets(tickets,{query:'MOBILE',status:'ready',priority:'high'}),[tickets[0]]);
  assert.deepEqual(filterTickets(tickets,{query:'RLY-1',status:'new'}),[]);
  assert.equal(tickets.length,2);
});
test('merge readiness requires current head, checks, evidence, independent approval, and open PR', () => {
  const pullRequest={state:'open',headSha:'a'.repeat(40),checksReady:true,evidenceReady:true,canMerge:true};
  assert.equal(mergeReadiness({pullRequest}).ready,true);
  for(const patch of [{state:'closed'},{checksReady:false},{evidenceReady:false},{canMerge:false},{headSha:'short'}]) assert.equal(mergeReadiness({pullRequest:{...pullRequest,...patch}}).ready,false);
  assert.equal(mergeReadiness({}).ready,false);
});
test('API uses same-origin cookies and CSRF only for mutations without credential storage', async () => {
  const calls=[];const request=createAPI({csrf:()=> 'test-csrf',fetcher:async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>({ok:true})};}});
  await request('/api/workspace');await request('/api/tickets',{method:'POST',body:{title:'Ticket'}});
  assert.equal(calls[0].options.headers['X-CSRF-Token'],undefined);
  assert.equal(calls[1].options.headers['X-CSRF-Token'],'test-csrf');
  assert.equal(calls[1].options.credentials,'same-origin');
  assert.equal(calls[1].options.body,'{"title":"Ticket"}');
  await assert.rejects(request('https://example.com'),/same-origin/);
});
test('API preserves server failure and conflict status, and rejects unreadable responses', async () => {
  const request=createAPI({fetcher:async()=>({ok:false,status:409,json:async()=>({error:'Ticket changed. Refresh first.',code:'conflict'})})});
  await assert.rejects(request('/api/tickets/RLY-1'),error=>error.status===409&&error.code==='conflict'&&error.message.includes('Refresh'));
  const invalid=createAPI({fetcher:async()=>({ok:true,json:async()=>{throw new Error('HTML');}})});
  await assert.rejects(invalid('/api/workspace'),/unreadable response/);
});
