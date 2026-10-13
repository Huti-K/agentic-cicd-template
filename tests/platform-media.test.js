import test from 'node:test';
import assert from 'node:assert/strict';
import {platformHarness,PR_SHA} from './helpers/platform-harness.js';
import {Store} from '../worker/db.js';
import {createApp} from '../worker/index.js';

test('published ticket video is public, seekable and never forwards credentials to the download host',async context=>{
  const api=await platformHarness(context);await api.signIn();
  const created=await api.createTicket(),store=new Store(api.DB);
  const job=await store.createJob(created.data.ticket,'evidence',PR_SHA);
  const url='/api/evidence/'+job.id+'/42.webm';
  await store.updateJob(job,{status:'succeeded',headSha:PR_SHA,evidence:[{kind:'video',assetId:42,url,headSha:PR_SHA,title:'Copy the ticket link'}]});
  const calls=[];
  const app=createApp({fetcher:async(url,init)=>{
    calls.push({url,init});
    if(calls.length===1)return new Response(null,{status:302,headers:{Location:'https://release-assets.githubusercontent.com/recording.webm?signature=fixture'}});
    assert.equal(new Headers(init.headers).has('authorization'),false);
    assert.equal(new Headers(init.headers).get('range'),'bytes=0-3');
    return new Response(new Uint8Array([26,69,223,163]),{status:206,headers:{'Content-Range':'bytes 0-3/100','Content-Length':'4'}});
  }});
  const response=await app.fetch(new Request('https://relay.test'+url,{headers:{Range:'bytes=0-3'}}),api.env);
  assert.equal(response.status,206);
  assert.equal(response.headers.get('Content-Type'),'video/webm');
  assert.equal(response.headers.get('Content-Range'),'bytes 0-3/100');
  assert.equal(response.headers.get('Accept-Ranges'),'bytes');
  assert.equal((await response.arrayBuffer()).byteLength,4);
  assert.equal(calls.length,2);
  assert.match(calls[0].url,/\/releases\/assets\/42$/);
  const missing=await app.fetch(new Request('https://relay.test/api/evidence/'+job.id+'/99.webm'),api.env);
  assert.equal(missing.status,404);assert.equal(calls.length,2);
});

import {publishedMedia} from '../worker/media.js';
const hash='sha256:'+'d'.repeat(64),posterHash='sha256:'+'e'.repeat(64);
function mediaFixture(){
  const job={id:'12345678-1234-4234-9234-123456789abc',runId:123,headSha:PR_SHA};
  const entry={title:'Copy the ticket link',device:'desktop',assetId:42,posterAssetId:43,digest:hash,posterDigest:posterHash};
  const release={tag_name:'relay-evidence-123',target_commitish:PR_SHA,draft:false,assets:[
    {id:42,name:'video-01-'+hash.slice(7)+'.webm',content_type:'video/webm',digest:hash,size:100,state:'uploaded'},
    {id:43,name:'poster-01-'+posterHash.slice(7)+'.png',content_type:'image/png',digest:posterHash,size:100,state:'uploaded'}]};
  return {job,entry,release};
}
test('recording registration binds IDs, digests, content types, run and exact revision',async()=>{
  const {job,entry,release}=mediaFixture();
  const github={call:async path=>{assert.equal(path,'/releases/tags/relay-evidence-123');return release;}};
  const [item]=await publishedMedia([entry],job,github);
  assert.equal(item.kind,'video');assert.equal(item.result,'passed');assert.equal(item.headSha,PR_SHA);
  assert.equal(item.url,'/api/evidence/'+job.id+'/42.webm');
  for(const patch of [{assetId:99},{device:'injected'},{digest:posterHash},{posterAssetId:42}])await assert.rejects(publishedMedia([{...entry,...patch}],job,github));
  await assert.rejects(publishedMedia([entry,entry],job,github));
  release.target_commitish='f'.repeat(40);await assert.rejects(publishedMedia([entry],job,github));
  release.target_commitish=PR_SHA;release.assets[0].content_type='text/html';await assert.rejects(publishedMedia([entry],job,github));
});

test('evidence callback publishes playable recordings atomically with the successful job',async context=>{
  const api=await platformHarness(context);await api.signIn();const created=await api.createTicket(),store=new Store(api.DB);
  let ticket=await store.update(created.data.ticket,{status:'in_review',prNumber:71,headSha:PR_SHA});
  let job=await store.createJob(ticket,'evidence',PR_SHA);job=await store.updateJob(job,{runId:123,status:'running'});
  ticket=await store.update(ticket,{activeJobId:job.id});
  const {entry,release}=mediaFixture();
  const app=createApp({fetcher:async(url,init)=>url.endsWith('/releases/tags/relay-evidence-123')?Response.json(release):api.github.fetcher(url,init)});
  const result=await app.fetch(new Request('https://relay.test/api/automation/jobs/'+job.id,{method:'POST',headers:{Authorization:'Bearer '+api.env.RELAY_CALLBACK_SECRET,'Content-Type':'application/json'},body:JSON.stringify({status:'succeeded',runId:123,headSha:PR_SHA,summary:'Recorded browser scenario passed.',media:[entry],evidence:[{kind:'artifact',title:'Full report',headSha:PR_SHA,url:'https://github.com/Huti-K/agentic-cicd-template/actions/runs/123/artifacts/9'}]})}),api.env);
  assert.equal(result.status,200,await result.text());
  const saved=await store.job(job.id);assert.equal(saved.status,'succeeded');assert.equal(saved.evidence[0].kind,'video');assert.equal(saved.evidence[1].kind,'artifact');
  assert.equal((await store.ticket(ticket.id)).activeJobId,null);
  assert.equal((await store.comments(ticket.id)).at(-1).kind,'evidence');
  const denied=createApp({fetcher:async()=>new Response(null,{status:302,headers:{Location:'https://attacker.test/collect'}})});
  const bad=await denied.fetch(new Request('https://relay.test'+saved.evidence[0].url),api.env);assert.equal(bad.status,502);
  const range=await app.fetch(new Request('https://relay.test'+saved.evidence[0].url,{headers:{Range:'bytes=1-2,3-4'}}),api.env);assert.equal(range.status,416);
  await store.updateJob(saved,{status:'failed'});
  const hidden=await app.fetch(new Request('https://relay.test'+saved.evidence[0].url),api.env);assert.equal(hidden.status,404);
});
