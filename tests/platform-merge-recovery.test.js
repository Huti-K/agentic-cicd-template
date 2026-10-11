import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../worker/db.js';
import { platformHarness, PR_SHA, BASE_SHA, MERGE_SHA, REPO } from './helpers/platform-harness.js';

async function reviewTicket(context,changes={}) {
  const api=await platformHarness(context);assert.equal((await api.signIn()).status,200);
  const created=await api.createTicket();assert.equal(created.status,201);
  const store=new Store(api.DB),ticket=await store.update(created.data.ticket,{status:'in_review',prNumber:71,prUrl:'https://github.com/'+REPO+'/pull/71',headSha:PR_SHA,triage:{ready:true},...changes});
  return {api,store,ticket};
}

test('an in-flight merge blocks edits and agent/human state transitions while preserving comments',async context=>{
  const {api,ticket}=await reviewTicket(context,{mergePending:true});
  for(const action of ['triage','implement','evidence','human-edit','resume','approve-merge']) {
    const result=await api.request('/api/tickets/RLY-1/actions',{method:'POST',body:{action,headSha:PR_SHA}});
    assert.equal(result.status,409,action+' must not race a merge');
  }
  const edit=await api.request('/api/tickets/RLY-1',{method:'PATCH',body:{version:ticket.version,title:'Changed while merging'}});
  assert.equal(edit.status,409);
  const commented=await api.request('/api/tickets/RLY-1/comments',{method:'POST',body:{body:'@ai please keep this follow-up note.',kind:'feedback'}});
  assert.equal(commented.status,200);
  assert.ok(commented.data.comments.some(comment=>comment.body.includes('follow-up note')));
  assert.equal(commented.data.ticket.mergePending,true);
  assert.equal(commented.data.ticket.status,'in_review');
  assert.equal(commented.data.jobs.length,0);
  assert.equal(api.github.dispatches.length,0);
  assert.equal(api.github.mergeCalls,0);
});

test('a confirmed exact-head GitHub merge recovers a lost local merge result without another merge',async context=>{
  const {api}=await reviewTicket(context,{mergePending:true,error:'The merge response was interrupted.'});
  api.github.pull.state='closed';api.github.pull.merged_at='2026-10-12T11:00:00Z';
  const recovered=await api.request('/api/tickets/RLY-1');
  assert.equal(recovered.status,200);
  assert.equal(recovered.data.ticket.status,'merged');
  assert.equal(recovered.data.ticket.mergeCommitSha,MERGE_SHA);
  assert.equal(recovered.data.ticket.mergePending,false);
  assert.equal(recovered.data.ticket.error,null);
  assert.equal(api.github.mergeCalls,0);
  const repeated=await api.request('/api/tickets/RLY-1');
  assert.equal(repeated.data.ticket.version,recovered.data.ticket.version,'read recovery must be idempotent');
});

test('merge recovery rejects another revision, wrong branch, invalid merge SHA, active job or human editing',async context=>{
  const {api,store}=await reviewTicket(context);api.github.pull.state='closed';api.github.pull.merged_at='2026-10-12T11:00:00Z';
  for(const scenario of [
    {headSha:BASE_SHA}, {branch:'another/ticket'}, {mergeSha:'invalid'}, {activeJobId:'active-job'}, {status:'human_edit'},
  ]) {
    let current=await store.ticket('RLY-1');await store.update(current,{status:scenario.status||'in_review',activeJobId:scenario.activeJobId||null});
    api.github.pull.head.sha=scenario.headSha||PR_SHA;api.github.pull.head.ref=scenario.branch||'relay/ticket-RLY-1';api.github.pull.merge_commit_sha=scenario.mergeSha||MERGE_SHA;
    const result=await api.request('/api/tickets/RLY-1');assert.equal(result.status,200);assert.equal(result.data.ticket.status,scenario.status||'in_review',JSON.stringify(scenario));
  }
});

test('merge recovery catches up a completed deployment only after verified commit ancestry',async context=>{
  const {api,store}=await reviewTicket(context,{mergePending:true});
  api.github.pull.state='closed';api.github.pull.merged_at='2026-10-12T11:00:00Z';
  await store.setMetadata('deployment',{sha:BASE_SHA,url:'https://relay.test'});
  api.github.compareStatus='diverged';
  const excluded=await api.request('/api/tickets/RLY-1');assert.equal(excluded.data.ticket.status,'merged');
  const comparisons=api.github.calls.filter(call=>call.path.includes('/compare/')).length;
  await api.request('/api/tickets/RLY-1');assert.equal(api.github.calls.filter(call=>call.path.includes('/compare/')).length,comparisons,'immutable ancestry is cached for this deployment');
  await store.update(await store.ticket('RLY-1'),{status:'in_review',mergePending:false,mergeCommitSha:null});
  const nextDeployment='d'.repeat(40);await store.setMetadata('deployment',{sha:nextDeployment,url:'https://relay.test'});
  api.github.compareStatus='ahead';
  const included=await api.request('/api/tickets/RLY-1');assert.equal(included.data.ticket.status,'deployed');
  assert.equal(included.data.ticket.deployedSha,nextDeployment);
  assert.ok(api.github.calls.some(call=>call.path.endsWith('/compare/'+MERGE_SHA+'...'+nextDeployment)));
  assert.equal(api.github.mergeCalls,0);
});

test('successful implementation callbacks cannot overwrite a changed description or title',async context=>{
  const {api,store,ticket}=await reviewTicket(context,{prNumber:null,prUrl:null,headSha:null,status:'ready'});
  let job=await store.createJob(ticket,'implement',BASE_SHA);job=await store.updateJob(job,{title:ticket.title});
  let current=await store.update(ticket,{status:'implementing',activeJobId:job.id});
  current=await store.update(current,{description:'A maintainer changed the requested behavior.'});
  const payload={status:'succeeded',runId:456,summary:'Implemented.',pullRequest:{number:71,headSha:PR_SHA}};
  assert.equal((await api.callback(job.id,payload)).status,409);
  current=await store.update(await store.ticket(ticket.id),{description:ticket.description,title:'A different user request'});
  assert.equal((await api.callback(job.id,payload)).status,409);
  assert.equal((await store.ticket(ticket.id)).title,'A different user request');
  assert.equal((await store.job(job.id)).status,'queued');
  assert.equal(api.github.dispatches.length,0);
});
