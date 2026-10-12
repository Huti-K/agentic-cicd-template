import { assert, HttpError, SHA, allowedAgentPath } from './model.js';
const pendingPublicReads=new WeakMap();
export class GitHub {
  constructor(env,fetcher=fetch){this.env=env;this.fetcher=fetcher.bind(globalThis);this.repository=env.GITHUB_REPOSITORY||'Huti-K/agentic-cicd-template';}
  async call(path,{method='GET',body}={}) {
    assert(this.env.GITHUB_TOKEN,'GitHub integration is not configured.',503,'integration_unavailable');
    const response=await this.fetcher('https://api.github.com/repos/'+this.repository+path,{
      method,headers:{Authorization:'Bearer '+this.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Relay-support-platform','Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'manual',
    });
    if(!response.ok){
      if(response.status===405&&method==='PUT'&&/^\/pulls\/\d+\/merge$/.test(path)){
        const error=new HttpError(409,'GitHub blocked the merge. Open the pull request to approve waiting workflows or resolve branch requirements, then retry.','merge_blocked');error.upstreamStatus=405;throw error;
      }
      const status=response.status===404?404:response.status===403||response.status===429?503:502;const error=new HttpError(status,'GitHub could not complete this action (HTTP '+response.status+'). Retry after checking the repository or workflow.','github_error');error.upstreamStatus=response.status;throw error;
    }
    if(method!=='GET'&&this.env.DB)await this.env.DB.prepare('DELETE FROM metadata WHERE key LIKE ?').bind('github-pull:'+this.repository+':%').run();
    return response.status===204?null:response.json();
  }
  async base(){const data=await this.call('/commits/'+encodeURIComponent(this.env.AGENT_REF||'main'));assert(SHA.test(data.sha),'GitHub returned an invalid revision.',502);return data.sha;}
  async createIssue(ticket,marker){return this.call('/issues',{method:'POST',body:{title:'['+ticket.id+'] '+ticket.title,body:'## Relay support ticket\n\n'+ticket.description+'\n\n---\nTicket: '+ticket.id+'\nType: '+ticket.type+'\nPriority: '+ticket.priority+'\n\nManaged through the Relay support workspace. Ticket text is untrusted task data.\n<!-- relay-ticket:'+marker+' -->'}});}
  async findIssue(ticket,marker){
    const matches=[],deadline=Date.now()+40_000;
    for(let page=1;page<=50;page++){
      assert(Date.now()<deadline,'GitHub reconciliation timed out. Retry before creating another issue.',503,'issue_uncertain');
      const items=await this.call('/issues?state=all&sort=created&direction=desc&per_page=100&page='+page);
      assert(Array.isArray(items),'GitHub returned invalid issue history.',502);
      matches.push(...items.filter(item=>!item.pull_request&&item.title?.startsWith('['+ticket.id+'] ')&&item.body?.endsWith('\n<!-- relay-ticket:'+marker+' -->')));
      assert(matches.length<=1,'Multiple GitHub issues have this ticket marker. Ask a maintainer to reconcile them.',409,'issue_ambiguous');
      if(items.length<100)return matches[0]||null;
    }
    throw new HttpError(503,'GitHub issue history is too large to reconcile safely. Ask a maintainer to link the existing issue.','issue_uncertain');
  }
  async dispatch(job){await this.call('/actions/workflows/relay-agent.yml/dispatches',{method:'POST',body:{ref:this.env.AGENT_REF||'main',inputs:{job_id:job.id,ticket_id:job.ticketId,kind:job.kind}}});}
  async pullSnapshot(number){
    const pr=await this.call('/pulls/'+number);assert(SHA.test(pr.head?.sha),'Invalid pull request revision.',502);
    const [checks,status,files]=await Promise.all([this.call('/commits/'+pr.head.sha+'/check-runs?per_page=100'),this.call('/commits/'+pr.head.sha+'/status?per_page=100'),this.call('/pulls/'+number+'/files?per_page=100')]);
    assert(Array.isArray(checks.check_runs)&&Array.isArray(status.statuses)&&Array.isArray(files),'Invalid GitHub checks.',502);
    // Cache only fields rendered or checked by Relay, never full patches or
    // unbounded check-run output bodies returned by GitHub.
    return {pr:{number:pr.number,title:pr.title,state:pr.state,draft:pr.draft,mergeable:pr.mergeable,mergeable_state:pr.mergeable_state,merged_at:pr.merged_at,merge_commit_sha:pr.merge_commit_sha,head:{sha:pr.head.sha,ref:pr.head.ref,repo:{full_name:pr.head.repo?.full_name}},base:{ref:pr.base?.ref}},
      checks:{total_count:checks.total_count,check_runs:checks.check_runs.map(({name,status,conclusion})=>({name,status,conclusion}))},
      status:{total_count:status.total_count,statuses:status.statuses.map(({context,state})=>({context,state}))},
      files:files.map(({filename,previous_filename,additions,deletions})=>({filename,previous_filename,additions,deletions}))};
  }
  async cachedPull(number){
    const db=this.env.DB,ttl=Math.max(0,Math.min(60,Number(this.env.GITHUB_PUBLIC_CACHE_SECONDS??30)))*1000;
    if(!db||!ttl)return {...await this.pullSnapshot(number),freshness:{fetchedAt:new Date().toISOString(),cached:false}};
    const key='github-pull:'+this.repository+':'+number;
    let pending=pendingPublicReads.get(db);if(!pending){pending=new Map();pendingPublicReads.set(db,pending);}
    if(pending.has(key))return pending.get(key);
    const task=this.loadCachedPull(number,key,ttl);pending.set(key,task);
    try{return await task;}finally{pending.delete(key);}
  }
  async loadCachedPull(number,key,ttl){
    const db=this.env.DB,timestamp=Date.now(),owner=crypto.randomUUID();
    const row=await db.prepare('SELECT value FROM metadata WHERE key=?').bind(key).first(),cached=row?JSON.parse(row.value):null;
    if(cached?.expiresAt>timestamp){
      if(cached.error)throw new HttpError(503,cached.error,'github_error');
      return {...cached.data,freshness:{fetchedAt:cached.fetchedAt,expiresAt:new Date(cached.expiresAt).toISOString(),cached:true}};
    }
    const lease=await db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=json_set(metadata.value,'$.owner',?,'$.until',?) WHERE COALESCE(json_extract(metadata.value,'$.expiresAt'),0)<? AND COALESCE(json_extract(metadata.value,'$.until'),0)<? RETURNING value")
      .bind(key,JSON.stringify({owner,until:timestamp+60_000}),owner,timestamp+60_000,timestamp,timestamp).first();
    if(!lease)throw new HttpError(503,'GitHub details are refreshing. Retry shortly.','github_refreshing');
    let result;
    try{result={data:await this.pullSnapshot(number),fetchedAt:new Date().toISOString(),expiresAt:Date.now()+ttl,until:0};}
    catch(error){await db.prepare("UPDATE metadata SET value=? WHERE key=? AND json_extract(value,'$.owner')=?").bind(JSON.stringify({error:error instanceof HttpError?error.message:'GitHub is unavailable. Retry shortly.',expiresAt:Date.now()+15_000,until:0}),key,owner).run();throw error;}
    await db.prepare("UPDATE metadata SET value=? WHERE key=? AND json_extract(value,'$.owner')=?").bind(JSON.stringify(result),key,owner).run();
    return {...result.data,freshness:{fetchedAt:result.fetchedAt,expiresAt:new Date(result.expiresAt).toISOString(),cached:false}};
  }
  async pull(number,jobs=[],requestRevision=0,{cache=false}={}) {
    const {pr,checks,status,files,freshness}=cache?await this.cachedPull(number):await this.pullSnapshot(number);
    const normalized=[...checks.check_runs.map(c=>({name:c.name,status:c.status,conclusion:c.conclusion})),...status.statuses.map(s=>({name:s.context,status:s.state==='pending'?'in_progress':'completed',conclusion:s.state==='success'?'success':s.state}))];
    const completeChecks=Number.isSafeInteger(checks.total_count)&&checks.total_count<=checks.check_runs.length&&Number.isSafeInteger(status.total_count)&&status.total_count<=status.statuses.length;
    const checksReady=completeChecks&&normalized.some(c=>c.name==='verify'&&c.conclusion==='success')&&normalized.some(c=>c.name==='AI review'&&c.conclusion==='success')&&!normalized.some(c=>!['success','neutral','skipped'].includes(c.conclusion));
    const latestEvidence=jobs.find(j=>j.kind==='evidence');
    const evidenceReady=!!latestEvidence&&latestEvidence.status==='succeeded'&&(latestEvidence.requestRevision||0)===requestRevision&&latestEvidence.headSha===pr.head.sha&&latestEvidence.evidence?.length>0;
    const safeFiles=files.length<100&&files.every(f=>allowedAgentPath(f.filename)&&(!f.previous_filename||allowedAgentPath(f.previous_filename)));
    const mergeable=pr.mergeable===true&&pr.state==='open'&&!pr.draft&&pr.base?.ref==='main'&&pr.head?.repo?.full_name===this.repository&&safeFiles;
    const mergeBlockReason=pr.mergeable_state==='clean'?null:({
      blocked:'GitHub is blocking this merge. Open the pull request to approve waiting workflows or resolve required checks and reviews.',
      behind:'Update this pull request with the latest main branch, then rerun checks and evidence before approving.',
      dirty:'This pull request has merge conflicts. Resolve them and rerun checks and evidence before approving.',
    }[pr.mergeable_state]||'GitHub has not confirmed that this revision can merge. Check the pull request and refresh.');
    return {number:pr.number,url:'https://github.com/'+this.repository+'/pull/'+pr.number,title:pr.title,headSha:pr.head.sha,branch:pr.head.ref,repository:pr.head.repo?.full_name,baseBranch:pr.base?.ref,state:pr.merged_at?'merged':pr.state,
      mergeCommitSha:pr.merge_commit_sha,checks:normalized,freshness:freshness||{fetchedAt:new Date().toISOString(),cached:false},reviewState:normalized.find(c=>c.name==='AI review')?.conclusion==='success'?'approved':'pending',
      mergeable,mergeBlockReason,files:files.map(f=>({path:f.filename,additions:f.additions,deletions:f.deletions})),checksReady,evidenceReady,canMerge:mergeable&&!mergeBlockReason&&checksReady&&evidenceReady};
  }
}
