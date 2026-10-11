import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepository, githubURL, issueDraftURL, createGitHubClient } from '../../demo/src/github.js';

test('repository input accepts a public GitHub URL and rejects path or credential injection',()=>{
  assert.equal(parseRepository(' https://github.com/Huti-K/agentic-cicd-template/ '),'Huti-K/agentic-cicd-template');
  for(const value of ['https://evil.example/a/b','../foo','owner/..','a/b/issues','a/b?token=secret','a/b#fragment','a@evil/b','a//b','','a/b\n/extra']) assert.throws(()=>parseRepository(value));
  assert.equal(githubURL('a/b','/issues/3'),'https://github.com/a/b/issues/3');
});
test('issue drafts encode sample content and stay on the selected GitHub repository',()=>{
  const url = new URL(issueDraftURL('owner/repo',{id:'ORB-143',title:'A & B # test',priority:'high',description:'<script>not executable</script>'},{name:'Orbit'}));
  assert.equal(url.origin,'https://github.com');
  assert.equal(url.pathname,'/owner/repo/issues/new');
  assert.equal(url.searchParams.get('title'),'[ORB-143] A & B # test');
  assert.match(url.searchParams.get('body'),/fictional sample data/);
});
test('public requests omit credentials, cache responses and refresh explicitly',async()=>{
  const calls=[];
  const client=createGitHubClient(async(url,options)=>{
    calls.push({url,options});
    const data=url.includes('/issues?')?[{number:1,title:'Issue'},{number:2,pull_request:{}}]:url.includes('/pulls?')?[]:url.includes('/actions/runs?')?{workflow_runs:[]}:{description:'Public repo'};
    return new Response(JSON.stringify(data));
  });
  const first=await client.snapshot('a/b');
  assert.equal(first.issues.length,1);assert.equal(first.repository,'a/b');
  await client.snapshot('a/b');assert.equal(calls.length,4);
  await client.snapshot('a/b',{fresh:true});assert.equal(calls.length,8);
  for(const call of calls){assert.equal(call.options.credentials,'omit');assert.equal(call.options.headers.Authorization,undefined);assert.ok(call.url.startsWith('https://api.github.com/repos/a/b'));}
});
test('API failures identify rate limiting, missing repositories and network outages',async()=>{
  for(const [status,message] of [[403,/rate limited/],[429,/rate limited/],[404,/Public repository not found/],[503,/503/]]){
    const client=createGitHubClient(async()=>new Response('{}',{status}));
    await assert.rejects(()=>client.snapshot('a/b'),message);
  }
  const offline=createGitHubClient(async()=>{throw new TypeError('offline');});
  await assert.rejects(()=>offline.snapshot('a/b'),/could not be reached/);
});
test('malformed and truncated GitHub responses are explicit',async()=>{
  const invalid=createGitHubClient(async()=>new Response('{}'));
  await assert.rejects(()=>invalid.snapshot('a/b'),/unexpected data/);
  const client=createGitHubClient(async url=>new Response(JSON.stringify(url.includes('/issues?')?Array.from({length:100},(_,index)=>({number:index+1})):url.includes('/pulls?')?[]:url.includes('/actions/runs?')?{workflow_runs:[]}:{description:''})));
  assert.equal((await client.snapshot('a/b')).limited,true);
});
test('PR checks are loaded for the actual head SHA alongside reviews and agent conversation comments',async()=>{
  const sha='b'.repeat(40),urls=[];
  const client=createGitHubClient(async url=>{
    urls.push(url);
    const data=url.includes('/reviews?')?[{body:'review'}]:url.includes('/comments?')?[{body:'agent result'}]:
      url.includes('/check-runs?')?{check_runs:[{name:'verify'}],total_count:1}:url.includes('/status?')?{statuses:[{context:'AI review'}],total_count:1}:{head:{sha}};
    return new Response(JSON.stringify(data));
  });
  const detail=await client.pullRequest('a/b',12);
  assert.equal(detail.reviews.length,1);assert.equal(detail.comments.length,1);assert.equal(detail.checks[0].name,'verify');assert.equal(detail.statuses[0].context,'AI review');
  assert.ok(urls.some(url=>url.includes('/commits/'+sha+'/check-runs')));
  await assert.rejects(()=>client.pullRequest('a/b','12'),/Invalid pull request/);
  const invalid=createGitHubClient(async()=>new Response(JSON.stringify({head:{sha:'../other'}})));
  await assert.rejects(()=>invalid.pullRequest('a/b',12),/invalid pull request revision/);
});
