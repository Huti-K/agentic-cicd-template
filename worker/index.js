import { PEOPLE, PROJECTS, HttpError, assert, text, ticketInput, mentions, SHA, triageResult, evidenceResult, sha256, equalSecret } from './model.js';
import { Store, now } from './db.js';
import { GitHub } from './github.js';

const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const publicJob=job=>{const {description,version,...value}=job;return value;};
const repositoryURL=repository=>'https://github.com/'+repository;
async function body(request) {
  assert(request.headers.get('content-type')?.split(';')[0]==='application/json','Use a JSON request body.',415);
  assert(Number(request.headers.get('content-length')||0)<=48_000,'Request body is too large.',413);
  const raw=await request.text();assert(raw.length<=48_000,'Request body is too large.',413);
  let data;try{data=JSON.parse(raw);}catch{throw new HttpError(400,'Invalid JSON request.');}
  assert(data&&typeof data==='object'&&!Array.isArray(data),'Supply a JSON object.');return data;
}
function origin(request) {assert(request.headers.get('origin')===new URL(request.url).origin,'This action must come from the Relay workspace.',403,'origin_mismatch');}
async function session(request,env) {
  const cookie=request.headers.get('cookie')||'';
  const token=cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith('relay_session='))?.slice(14);
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  const idHash=await sha256(token);
  const result=await env.DB.prepare('SELECT * FROM sessions WHERE id_hash=? AND expires_at>?').bind(idHash,Date.now()).first();
  return result?{idHash,csrf:result.csrf}:null;
}
function sessionBody(value){return value?{authenticated:true,user:PEOPLE[0],csrfToken:value.csrf}:{authenticated:false,user:null};}
const randomSecret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
async function writeSession(request,env) {
  origin(request);const current=await session(request,env);
  assert(current,'Sign in as a maintainer to make changes.',401,'authentication_required');
  assert(await equalSecret(request.headers.get('x-csrf-token'),current.csrf),'Your session changed. Sign in again or refresh the page.',403,'csrf_invalid');
  return current;
}
function cookieHeader(token,request,maxAge=43_200) {
  const local=['localhost','127.0.0.1'].includes(new URL(request.url).hostname);
  return 'relay_session='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge+(local?'':'; Secure');
}
async function ensureIssue(store,github,ticket) {
  if(ticket.issueNumber)return ticket;
  const issue=await github.createIssue(ticket);assert(Number.isSafeInteger(issue.number)&&issue.number>0,'GitHub returned an invalid issue.',502);
  return store.update(ticket,{issueNumber:issue.number,issueUrl:repositoryURL(github.repository)+'/issues/'+issue.number,error:null});
}
async function createTicket(store,github,input) {
  const properties=ticketInput(input);
  let ticket=await store.create(newTicket(properties));
  try{ticket=await ensureIssue(store,github,ticket);}catch(error){ticket=await store.update(ticket,{error:error.message});}
  await store.comment(ticket.id,'Ticket created. Mention @ai to start triage.','huti','event');
  return ticket;
}
function newTicket(properties){return {...properties,originalDescription:properties.description,status:'new',issueNumber:null,issueUrl:null,prNumber:null,prUrl:null,headSha:null,triage:null,error:null,activeJobId:null,pendingAgent:null,mergeCommitSha:null,mergePending:false};}
async function dispatchQueued(store,github,job){
  const claimed=await store.claimDispatch(job);
  if(!claimed)return false;
  try{await github.dispatch(claimed);await store.acceptedDispatch(claimed);return true;}
  catch(error){
    const current=await store.job(job.id);
    if(current.runId)return true; // A callback proves GitHub accepted an ambiguous response.
    await store.updateJob(current,{status:'failed',summary:error.message});
    const ticket=await store.ticket(job.ticketId);
    if(ticket.activeJobId===job.id)await store.update(ticket,{status:'failed',activeJobId:null,pendingAgent:ticket.pendingAgent||job.consumedPending||null,error:error.message});
    throw error;
  }
}
async function queueJob(store,github,env,id,kind) {
  let ticket=await store.ticket(id);
  assert(!ticket.mergePending,'A merge is in progress. Wait for its result before starting more work.',409,'merge_pending');
  assert(!['merged','deployed'].includes(ticket.status),'This ticket has already shipped.',409);
  assert(ticket.status!=='human_edit','Resume automation before starting an agent.',409,'human_edit');
  if(ticket.pendingAgent)kind=ticket.prNumber?'implement':'triage';
  const active=(await store.jobs()).filter(job=>['queued','running'].includes(job.status));
  const existing=active.find(job=>job.ticketId===id);
  if(existing&&existing.id===ticket.activeJobId&&existing.dispatchState==='pending'&&await dispatchQueued(store,github,existing))return store.job(existing.id);
  assert(!existing,'An agent is already working on this ticket.',409,'job_active');
  assert(active.length<3,'Three agents are already running. Try again when one finishes.',429,'agent_capacity');
  if(kind==='implement')assert(ticket.triage?.ready||ticket.prNumber,'Triage must mark this ticket ready before implementation.',409,'not_ready');
  if(kind==='evidence')assert(ticket.prNumber&&SHA.test(ticket.headSha),'A pull request is required for evidence.',409);
  await store.rate('paid-agent-runs',30,3600);
  ticket=await ensureIssue(store,github,ticket);
  const baseSha=await github.base();
  if(ticket.prNumber){
    const currentPR=await github.call('/pulls/'+ticket.prNumber);
    assert(currentPR.state==='open'&&SHA.test(currentPR.head?.sha),'The linked pull request is no longer open.',409);
    if(currentPR.head.sha!==ticket.headSha)ticket=await store.update(ticket,{headSha:currentPR.head.sha});
  }
  const {job}=await store.startJob(ticket,kind,baseSha);
  await dispatchQueued(store,github,job);return store.job(job.id);
}
async function drainPending(store,github,env,id){
  for(let attempt=0;attempt<3;attempt++){
    const ticket=await store.ticket(id);
    if(ticket.mergePending||['human_edit','merged','deployed'].includes(ticket.status))return false;
    if(ticket.activeJobId){const job=await store.job(ticket.activeJobId);if(job.dispatchState==='pending')try{await dispatchQueued(store,github,job);}catch{/* A failed dispatch restores the durable request and error. */}return false;}
    if(!ticket.pendingAgent)return false;
    try{await queueJob(store,github,env,id,ticket.prNumber?'implement':'triage');return true;}
    catch(error){
      if(['version_conflict','job_active'].includes(error.code))continue;
      const latest=await store.ticket(id);
      if(latest.pendingAgent&&!latest.activeJobId)await store.update(latest,{error:'Feedback is saved; its agent could not start. Retry the agent action. '+error.message});
      return false;
    }
  }
  return false;
}
async function detail(store,github,id,{withPR=true}={}) {
  let [ticket,comments,jobs]=await Promise.all([store.ticket(id),store.comments(id),store.jobs(id)]);
  let pullRequest=null;
  let integrationError=null;
  if(withPR&&ticket.prNumber){
    try{pullRequest=await github.pull(ticket.prNumber,jobs);}catch(error){integrationError=error.message;}
  }
  // GitHub may have accepted a merge before the response or local write failed.
  // Recover only the ticket's exact linked revision; never issue another merge.
  if(pullRequest?.state==='merged'&&(ticket.status==='in_review'||ticket.mergePending)&&!ticket.activeJobId&&
    pullRequest.number===ticket.prNumber&&pullRequest.headSha===ticket.headSha&&SHA.test(pullRequest.mergeCommitSha)&&
    pullRequest.branch==='relay/ticket-'+ticket.id&&pullRequest.repository===github.repository&&pullRequest.baseBranch==='main'){
    try{
      ticket=await store.update(ticket,{status:'merged',mergePending:false,mergeStartedAt:null,pendingAgent:null,mergeCommitSha:pullRequest.mergeCommitSha,error:null});
    }catch(error){
      if(error.code!=='version_conflict')throw error;
      ticket=await store.ticket(id);
    }
  }
  const mergeStarted=Date.parse(ticket.mergeStartedAt||ticket.updatedAt);
  if(ticket.mergePending&&Number.isFinite(mergeStarted)&&Date.now()-mergeStarted>60_000&&pullRequest&&['open','closed'].includes(pullRequest.state)&&
    pullRequest.number===ticket.prNumber&&pullRequest.headSha===ticket.headSha&&pullRequest.branch==='relay/ticket-'+ticket.id&&pullRequest.repository===github.repository&&pullRequest.baseBranch==='main'){
    try{ticket=await store.update(ticket,{mergePending:false,mergeStartedAt:null,error:'The previous merge was interrupted. GitHub confirms this revision is unmerged; review it and retry.'});}
    catch(error){if(error.code!=='version_conflict')throw error;ticket=await store.ticket(id);}
  }
    // A deployment callback may have arrived while the local merge result was
    // missing. Retry this check on later reads if GitHub was unavailable.
    if(ticket.status==='merged'&&SHA.test(ticket.mergeCommitSha)){
      const deployed=await store.metadata('deployment');
      if(SHA.test(deployed?.sha)){
        try{
          const comparison=await github.call('/compare/'+ticket.mergeCommitSha+'...'+deployed.sha);
          if(['ahead','identical'].includes(comparison.status))ticket=await store.update(ticket,{status:'deployed',deployedSha:deployed.sha,error:null});
        }catch(error){
          if(error.code==='version_conflict')ticket=await store.ticket(id);
          else integrationError='The merge is confirmed, but its deployment could not be checked. '+error.message;
        }
      }
    }
  if(pullRequest)pullRequest.canMerge=pullRequest.canMerge&&ticket.status==='in_review'&&!ticket.activeJobId&&!ticket.mergePending&&!ticket.pendingAgent;
  const evidence=jobs.filter(job=>job.status==='succeeded').flatMap(job=>(job.evidence||[]).map(item=>({...item,jobId:job.id})));
  return {ticket,comments,jobs:jobs.map(publicJob),evidence,pullRequest,integrationError};
}
async function stopForHuman(store,github,ticket) {
  assert(!ticket.mergePending,'A merge is in progress. Wait for its result before switching to human editing.',409,'merge_pending');
  // Pause first: a concurrent queue or terminal callback must fail its version
  // guard before any network cancellation work can yield control.
  const {ticket:updated,jobs}=await store.pauseTicket(ticket);
  for(const job of jobs){
    if(job.runId)try{await github.call('/actions/runs/'+job.runId+'/cancel',{method:'POST'});}catch{/* Local cancellation still prevents callback publication. */}
  }
  await store.comment(ticket.id,'Automation paused for human editing. Resume when the ticket is ready.','huti','event');return updated;
}
async function performAction(store,github,env,id,input) {
  let ticket=await store.ticket(id);
  assert(['triage','implement','evidence','human-edit','resume','approve-merge'].includes(input.action),'Unknown ticket action.');
  assert(!ticket.mergePending,'A merge is in progress. Wait for its result before changing the workflow.',409,'merge_pending');
  if(['triage','implement','evidence'].includes(input.action)){await queueJob(store,github,env,id,input.action);return;}
  if(input.action==='human-edit'){assert(!['merged','deployed'].includes(ticket.status),'A shipped ticket cannot be edited.',409);await stopForHuman(store,github,ticket);return;}
  if(input.action==='resume'){
    assert(ticket.status==='human_edit','This ticket is not paused for human editing.',409);
    await store.update(ticket,{status:ticket.prNumber?'in_review':ticket.triage?.ready?'ready':'new',error:null});
    await store.comment(id,'Automation resumed.','huti','event');return;
  }
  assert(ticket.status==='in_review'&&!ticket.activeJobId&&!ticket.mergePending&&!ticket.pendingAgent&&ticket.prNumber,'This ticket is not ready to merge. Resolve pending feedback first.',409,'merge_blocked');
  assert(SHA.test(input.headSha),'Confirm the exact pull request revision.');
  const pr=await github.pull(ticket.prNumber,await store.jobs(id));
  assert(pr.headSha===input.headSha&&pr.headSha===ticket.headSha,'The pull request changed. Review the current revision before merging.',409,'stale_head');
  assert(pr.canMerge&&pr.branch==='relay/ticket-'+ticket.id,'Merge is blocked. Current-head checks, independent AI review, and successful evidence are required on the ticket branch.',409,'merge_blocked');
  ticket=await store.update(ticket,{mergePending:true,mergeStartedAt:now()});
  try{
    const result=await github.call('/pulls/'+ticket.prNumber+'/merge',{method:'PUT',body:{sha:input.headSha,merge_method:'squash',commit_title:ticket.title+' (#'+ticket.prNumber+')'}});
    assert(result.merged&&SHA.test(result.sha),'GitHub did not merge the pull request. Check branch protection.',409);
    const latest=await store.ticket(id);
    await store.update(latest,{status:latest.status==='deployed'&&latest.mergeCommitSha===result.sha?'deployed':'merged',mergePending:false,mergeStartedAt:null,pendingAgent:null,mergeCommitSha:result.sha,error:null});
    await store.comment(id,'Approved and merged PR #'+ticket.prNumber+'. Cloudflare deployment will follow main CI.','huti','event');
  }catch(error){const latest=await store.ticket(id);if(latest.mergePending)await store.update(latest,{error:'Merge result could not be confirmed. Refresh after a minute to reconcile GitHub. '+error.message});throw error;}
}
async function comment(store,github,env,id,input) {
  const content=text(input.body,8000,'Comment'),kind=input.kind||'comment';
  assert(['comment','feedback'].includes(kind),'Choose comment or feedback.');
  const added=mentions(content);
  let ticket;
  for(let attempt=0;attempt<3;attempt++){
    ticket=await store.ticket(id);
    assert(!['merged','deployed'].includes(ticket.status)||kind!=='feedback','A shipped ticket cannot restart implementation.',409);
    if(kind==='feedback')assert(ticket.prNumber,'Feedback requires a linked pull request.',409);
    const changes={contributorIds:[...new Set([...ticket.contributorIds,'huti',...added])]};
    if((added.includes('ai')||kind==='feedback')&&!ticket.mergePending&&!['human_edit','merged','deployed'].includes(ticket.status))changes.pendingAgent={id:crypto.randomUUID(),requestedAt:now()};
    try{ticket=await store.appendComment(ticket,content,kind,changes);break;}
    catch(error){if(error.code!=='version_conflict'||attempt===2)throw error;}
  }
  if(ticket.pendingAgent){
    if(ticket.activeJobId)await store.comment(id,'Feedback saved. One follow-up agent will start after the current run completes.','ai','event');
    else await drainPending(store,github,env,id);
  }
}
async function inboxRequest(store,github,env,input) {
  const senderName=text(input.senderName,100,'Sender name'),senderEmail=text(input.senderEmail,160,'Sender email'),subject=text(input.subject,160,'Subject'),content=text(input.body,8000,'Email body'),key=text(input.idempotencyKey,100,'Idempotency key');
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail),'Enter a valid fictional sender email.');
  const requestHash=await sha256(JSON.stringify({senderName,senderEmail,subject,body:content}));
  let message=await store.inboxTicket(key,requestHash,{id:crypto.randomUUID(),senderName,senderEmail,subject,body:content,ticketId:null,createdAt:now()},newTicket(ticketInput({title:subject,description:content,type:'task',priority:'medium',tags:['support','mock-email']})));
  if(message.processingComplete)return {message,ticket:await store.ticket(message.ticketId)};
  message=await store.claimInbox(message.id);
  let complete=false;
  try{
    let ticket=await store.ticket(message.ticketId);
    const jobs=await store.jobs(ticket.id);
    if(['human_edit','merged','deployed'].includes(ticket.status)||jobs.some(job=>job.status==='succeeded'||job.runId)){complete=true;}
    else if(ticket.activeJobId){
      const active=jobs.find(job=>job.id===ticket.activeJobId);
      if(active?.dispatchState==='pending')await dispatchQueued(store,github,active);
      complete=(await store.job(ticket.activeJobId)).dispatchState==='accepted';
    }
    else{
      ticket=await ensureIssue(store,github,ticket);
      await queueJob(store,github,env,ticket.id,'triage');
      complete=true;
      await store.comment(ticket.id,'Created from a simulated support email by '+senderName+'.','huti','event');
    }
  }catch(error){const ticket=await store.ticket(message.ticketId);await store.update(ticket,{error:'Email saved; retry delivery with the same key to resume triage. '+error.message});}
  message=await store.finishInbox(message,complete);
  return {message,ticket:await store.ticket(message.ticketId)};
}
async function automationCallback(store,github,env,jobId,input) {
  const job=await store.job(jobId),ticket=await store.ticket(job.ticketId);
  assert(['running','succeeded','failed'].includes(input.status),'Invalid agent job state.');
  assert(Number.isSafeInteger(Number(input.runId))&&Number(input.runId)>0,'Invalid workflow run.');
  const runId=Number(input.runId);
  if(job.runId)assert(job.runId===runId,'This callback belongs to another workflow run.',409,'run_mismatch');
  if(['succeeded','failed'].includes(job.status)){
    assert(job.status===input.status,'The job already finished with a different result.',409,'job_finished');
    await drainPending(store,github,env,ticket.id);
    return {ok:true,duplicate:true};
  }
  assert(ticket.activeJobId===job.id&&ticket.status!=='human_edit','This agent job is no longer current.',409,'stale_job');
  let triage=null,pullRequest=null,evidence=null;
  const summary=text(input.summary||input.error||'Agent '+input.status,4000,'Agent summary');
  if(input.status==='succeeded'){
    assert(ticket.description===job.description,'The ticket description changed during this run. Start a new run from the current request.',409,'stale_description');
    if(typeof job.title==='string')assert(ticket.title===job.title,'The ticket title changed during this run. Start a new run from the current request.',409,'stale_title');
    if(job.kind==='triage')triage=triageResult(input.triage);
    if(job.kind==='implement'){
      assert(input.pullRequest&&Number.isSafeInteger(input.pullRequest.number)&&input.pullRequest.number>0&&SHA.test(input.pullRequest.headSha),'Invalid pull request result.');
      pullRequest=input.pullRequest;
      const current=await github.call('/pulls/'+pullRequest.number);
      assert(current.head?.sha===pullRequest.headSha&&current.head?.ref==='relay/ticket-'+ticket.id&&current.head?.repo?.full_name===github.repository&&current.base?.ref==='main'&&current.state==='open','The published pull request does not match this ticket.',409,'stale_head');
    }
    if(job.kind==='evidence'){
      assert(SHA.test(input.headSha)&&input.headSha===job.headSha&&input.headSha===ticket.headSha,'Evidence is for an old revision.',409,'stale_head');
      const current=await github.call('/pulls/'+ticket.prNumber);assert(current.head?.sha===job.headSha,'The PR changed during evidence collection.',409,'stale_head');
      evidence=evidenceResult(input.evidence,github.repository,input.headSha,runId);
    }
    if(job.kind==='triage')assert(ticket.description===job.description,'The ticket description changed during triage. Rerun triage.',409,'stale_description');
  }
  const runUrl=repositoryURL(github.repository)+'/actions/runs/'+runId;
  if(input.status==='running'){
    await store.updateJob(job,{status:'running',runId,runUrl,summary});return {ok:true};
  }
  // Re-read after remote validation and commit the job, ticket, and event as one
  // guarded transaction. Human edits cannot land between separate terminal writes.
  const latest=await store.ticket(ticket.id);
  if(latest.activeJobId!==job.id)throw new HttpError(409,'The ticket moved on before the agent finished.','stale_job');
  if(input.status==='succeeded'){
    assert(latest.description===job.description,'The ticket description changed during this run. Start a new run from the current request.',409,'stale_description');
    if(typeof job.title==='string')assert(latest.title===job.title,'The ticket title changed during this run. Start a new run from the current request.',409,'stale_title');
  }
  const jobChanges={status:input.status,runId,runUrl,summary,headSha:pullRequest?.headSha||job.headSha,evidence:evidence||job.evidence||[]};
  let ticketChanges,event;
  if(input.status==='failed'){
    ticketChanges={status:job.kind==='evidence'?'in_review':'failed',activeJobId:null,error:summary};
    event={body:summary,kind:'agent'};
  }else if(triage){
    ticketChanges={description:triage.description,triage,status:triage.ready?'ready':latest.pendingAgent?'new':'human_edit',activeJobId:null,error:null};
    event={body:triage.summary,kind:'triage'};
  }else if(pullRequest){
    ticketChanges={prNumber:pullRequest.number,prUrl:repositoryURL(github.repository)+'/pull/'+pullRequest.number,headSha:pullRequest.headSha,status:'in_review',activeJobId:null,error:null};
    event={body:summary,kind:'implementation'};
  }else{
    ticketChanges={status:'in_review',activeJobId:null,error:null};
    event={body:summary,kind:'evidence'};
  }
  await store.finishJob(job,latest,jobChanges,ticketChanges,event);
  await drainPending(store,github,env,ticket.id);
  const finished=await store.ticket(ticket.id);
  if(pullRequest&&!finished.pendingAgent&&!finished.activeJobId&&finished.status!=='human_edit'){
    try{await queueJob(store,github,env,ticket.id,'evidence');}catch(error){const current=await store.ticket(ticket.id);await store.update(current,{error:'PR created; evidence could not start: '+error.message});}
  }
  return {ok:true};
}
async function deploymentCallback(store,github,env,input) {
  assert(SHA.test(input.sha),'Invalid deployed revision.');
  assert(typeof input.url==='string'&&input.url.replace(/\/$/,'')===(env.DEPLOYMENT_URL||'').replace(/\/$/,''),'Unexpected deployment URL.');
  const info={url:input.url,sha:input.sha,runId:String(input.runId||''),deployedAt:now()};
  await store.setMetadata('deployment',info);
  for(const ticket of (await store.listTickets()).filter(ticket=>ticket.status==='merged'&&SHA.test(ticket.mergeCommitSha))){
    const comparison=await github.call('/compare/'+ticket.mergeCommitSha+'...'+input.sha);
    if(['ahead','identical'].includes(comparison.status)){
      await store.update(ticket,{status:'deployed',deployedSha:input.sha,error:null});
      await store.comment(ticket.id,'Deployed to Cloudflare. The change is live.','ai','deployment');
    }
  }
  return {ok:true};
}
export function createApp({fetcher=globalThis.fetch}={}) {
  return { async fetch(request,env,ctx={}) {
    const url=new URL(request.url);
    try{
      if(!url.pathname.startsWith('/api/')){
        const response=await env.ASSETS.fetch(request);
        const headers=new Headers(response.headers);
        headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','strict-origin-when-cross-origin');headers.set('X-Frame-Options','DENY');
        headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.github.com; media-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
        return new Response(response.body,{status:response.status,headers});
      }
      assert(env.DB,'The ticket database is not configured.',503);
      const store=new Store(env.DB),github=new GitHub(env,fetcher),path=url.pathname;
      if(path.startsWith('/api/automation/')){
        assert(await equalSecret(request.headers.get('authorization'),'Bearer '+(env.RELAY_CALLBACK_SECRET||''))&&!!env.RELAY_CALLBACK_SECRET,'Invalid automation credential.',401);
        const match=path.match(/^\/api\/automation\/jobs\/([a-f0-9-]{36})$/);
        if(match&&request.method==='GET'){
          const job=await store.job(match[1]),ticket=await store.ticket(job.ticketId);
          assert(['queued','running'].includes(job.status)&&ticket.activeJobId===job.id,'The job is no longer current.',409,'stale_job');
          return json({job,ticket,comments:await store.comments(ticket.id),repository:github.repository,branch:'relay/ticket-'+ticket.id,baseSha:job.baseSha});
        }
        if(match&&request.method==='POST')return json(await automationCallback(store,github,env,match[1],await body(request)));
        if(path==='/api/automation/deployment'&&request.method==='POST')return json(await deploymentCallback(store,github,env,await body(request)));
        throw new HttpError(404,'Automation endpoint not found.');
      }
      if(path==='/api/session'){
        if(request.method==='GET')return json(sessionBody(await session(request,env)));
        if(request.method==='POST'){
          origin(request);
          await store.rate('signin:'+await sha256(request.headers.get('CF-Connecting-IP')||'local'),10,900);
          const input=await body(request);const password=text(input.password,256,'Password');
          assert(env.MAINTAINER_PASSWORD_HASH,'Maintainer sign-in has not been configured.',503);
          assert(await equalSecret(await sha256(password),env.MAINTAINER_PASSWORD_HASH),'Incorrect maintainer password.',401,'invalid_password');
          const token=randomSecret(),csrf=randomSecret(),idHash=await sha256(token);
          await store.db.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()).run();
          await store.db.prepare('INSERT INTO sessions(id_hash,csrf,expires_at) VALUES(?,?,?)').bind(idHash,csrf,Date.now()+43_200_000).run();
          return json(sessionBody({csrf}),200,{'Set-Cookie':cookieHeader(token,request)});
        }
        if(request.method==='DELETE'){const current=await writeSession(request,env);await store.db.prepare('DELETE FROM sessions WHERE id_hash=?').bind(current.idHash).run();return json(sessionBody(null),200,{'Set-Cookie':cookieHeader('',request,0)});}
      }
      if(request.method==='GET'&&path==='/api/workspace')return json({repository:github.repository,people:PEOPLE,projects:PROJECTS,tickets:await store.listTickets(),jobs:(await store.jobs()).map(publicJob),integration:{github:!!env.GITHUB_TOKEN,agents:!!env.GITHUB_TOKEN&&!!env.RELAY_CALLBACK_SECRET},deployment:await store.metadata('deployment')||{url:env.DEPLOYMENT_URL||url.origin,sha:null}});
      if(request.method==='GET'&&path==='/api/inbox')return json({messages:await store.inbox()});
      const ticketMatch=path.match(/^\/api\/tickets\/(RLY-[1-9][0-9]{0,7})(?:\/(comments|actions))?$/);
      if(request.method==='GET'&&ticketMatch&&!ticketMatch[2])return json(await detail(store,github,ticketMatch[1]));
      if(['POST','PATCH','DELETE'].includes(request.method))await writeSession(request,env);
      else throw new HttpError(404,'Endpoint not found.');
      if(request.method==='POST'&&path==='/api/tickets'){const ticket=await createTicket(store,github,await body(request));return json(await detail(store,github,ticket.id),201);}
      if(request.method==='POST'&&path==='/api/inbox')return json(await inboxRequest(store,github,env,await body(request)),201);
      if(ticketMatch){
        const id=ticketMatch[1],input=await body(request);
        if(request.method==='PATCH'&&!ticketMatch[2]){
          const ticket=await store.ticket(id);
          assert(!ticket.mergePending,'A merge is in progress. Wait for its result before editing the ticket.',409,'merge_pending');
          assert(Number.isSafeInteger(input.version)&&input.version===ticket.version,'This ticket changed. Refresh it before saving again.',409,'version_conflict');
          assert(!['merged','deployed'].includes(ticket.status),'Shipped tickets cannot be edited.',409);
          const properties=ticketInput(input,ticket);
          await store.update(ticket,{...properties,...(properties.description!==ticket.description?{triage:null}:{} )});
        }else if(request.method==='POST'&&ticketMatch[2]==='comments')await comment(store,github,env,id,input);
        else if(request.method==='POST'&&ticketMatch[2]==='actions')await performAction(store,github,env,id,input);
        else throw new HttpError(404,'Endpoint not found.');
        return json(await detail(store,github,id));
      }
      throw new HttpError(404,'Endpoint not found.');
    }catch(error){
      const expected=error instanceof HttpError;
      if(!expected)console.error('Relay request failed:',error?.name||'Error');
      return json({error:expected?error.message:'The request could not be completed. Please try again.',code:expected?error.code:'internal_error'},expected?error.status:500);
    }
  }};
}
export default createApp();
