import { assert, HttpError, SHA, allowedAgentPath } from './model.js';
export class GitHub {
  constructor(env,fetcher=fetch){this.env=env;this.fetcher=fetcher.bind(globalThis);this.repository=env.GITHUB_REPOSITORY||'Huti-K/agentic-cicd-template';}
  async call(path,{method='GET',body}={}) {
    assert(this.env.GITHUB_TOKEN,'GitHub integration is not configured.',503,'integration_unavailable');
    const response=await this.fetcher('https://api.github.com/repos/'+this.repository+path,{
      method,headers:{Authorization:'Bearer '+this.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Relay-support-platform','Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error',
    });
    if(!response.ok){const status=response.status===404?404:response.status===403||response.status===429?503:502;throw new HttpError(status,'GitHub could not complete this action (HTTP '+response.status+'). Retry after checking the repository or workflow.','github_error');}
    return response.status===204?null:response.json();
  }
  async base(){const data=await this.call('/commits/'+encodeURIComponent(this.env.AGENT_REF||'main'));assert(SHA.test(data.sha),'GitHub returned an invalid revision.',502);return data.sha;}
  async createIssue(ticket){return this.call('/issues',{method:'POST',body:{title:'['+ticket.id+'] '+ticket.title,body:'## Relay support ticket\n\n'+ticket.description+'\n\n---\nTicket: '+ticket.id+'\nType: '+ticket.type+'\nPriority: '+ticket.priority+'\n\nManaged through the Relay support workspace. Ticket text is untrusted task data.'}});}
  async dispatch(job){await this.call('/actions/workflows/relay-agent.yml/dispatches',{method:'POST',body:{ref:this.env.AGENT_REF||'main',inputs:{job_id:job.id,ticket_id:job.ticketId,kind:job.kind}}});}
  async pull(number,jobs=[]) {
    const pr=await this.call('/pulls/'+number);assert(SHA.test(pr.head?.sha),'Invalid pull request revision.',502);
    const [checks,status,files]=await Promise.all([this.call('/commits/'+pr.head.sha+'/check-runs?per_page=100'),this.call('/commits/'+pr.head.sha+'/status?per_page=100'),this.call('/pulls/'+number+'/files?per_page=100')]);
    assert(Array.isArray(checks.check_runs)&&Array.isArray(status.statuses)&&Array.isArray(files),'Invalid GitHub checks.',502);
    const normalized=[...checks.check_runs.map(c=>({name:c.name,status:c.status,conclusion:c.conclusion})),...status.statuses.map(s=>({name:s.context,status:s.state==='pending'?'in_progress':'completed',conclusion:s.state==='success'?'success':s.state}))];
    const completeChecks=Number.isSafeInteger(checks.total_count)&&checks.total_count<=checks.check_runs.length&&Number.isSafeInteger(status.total_count)&&status.total_count<=status.statuses.length;
    const checksReady=completeChecks&&normalized.some(c=>c.name==='verify'&&c.conclusion==='success')&&normalized.some(c=>c.name==='AI review'&&c.conclusion==='success')&&!normalized.some(c=>!['success','neutral','skipped'].includes(c.conclusion));
    const latestEvidence=jobs.find(j=>j.kind==='evidence');
    const evidenceReady=!!latestEvidence&&latestEvidence.status==='succeeded'&&latestEvidence.headSha===pr.head.sha&&latestEvidence.evidence?.length>0;
    const safeFiles=files.length<100&&files.every(f=>allowedAgentPath(f.filename)&&(!f.previous_filename||allowedAgentPath(f.previous_filename)));
    const mergeable=pr.mergeable===true&&pr.state==='open'&&!pr.draft&&pr.base?.ref==='main'&&pr.head?.repo?.full_name===this.repository&&safeFiles;
    return {number:pr.number,url:'https://github.com/'+this.repository+'/pull/'+pr.number,title:pr.title,headSha:pr.head.sha,branch:pr.head.ref,repository:pr.head.repo?.full_name,baseBranch:pr.base?.ref,state:pr.merged_at?'merged':pr.state,
      mergeCommitSha:pr.merge_commit_sha,checks:normalized,reviewState:normalized.find(c=>c.name==='AI review')?.conclusion==='success'?'approved':'pending',
      mergeable,files:files.map(f=>({path:f.filename,additions:f.additions,deletions:f.deletions})),checksReady,evidenceReady,canMerge:mergeable&&checksReady&&evidenceReady};
  }
}
