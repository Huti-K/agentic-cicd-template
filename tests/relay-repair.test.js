import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
import {browserFailures,verificationReport,failureSummary} from '../scripts/relay/verification-feedback.mjs';
import {publishedHead} from '../scripts/relay/run.mjs';

test('publication tolerates delayed PR metadata only while the exact verified branch head is unchanged',async()=>{
  const sha='a'.repeat(40),old='b'.repeat(40),value={repository:'owner/repo',branch:'relay/ticket-RLY-1',ticket:{}};
  const pr={number:1,state:'open',draft:false,head:{sha:old,ref:value.branch,repo:{full_name:value.repository}}};
  const delays=[],reads=[];
  const api={github:async path=>{reads.push(path);return path.startsWith('git/ref/')?{object:{sha}}:{...pr,head:{...pr.head,sha}};}};
  assert.equal((await publishedHead(api,value,pr,sha,{wait:async ms=>delays.push(ms)})).head.sha,sha);
  assert.deepEqual(delays,[500]);assert.equal(reads.filter(path=>path.startsWith('git/ref/')).length,2);
  await assert.rejects(publishedHead({github:async()=>({object:{sha:old}})},value,pr,sha,{wait:async()=>assert.fail('Must not wait on a changed branch')}),/branch changed/);
  let waits=0;
  await assert.rejects(publishedHead({github:async path=>path.startsWith('git/ref/')?{object:{sha}}:pr},value,pr,sha,{wait:async()=>waits++}),/not reflected/);
  assert.equal(waits,3);
  await assert.rejects(publishedHead(api,value,{...pr,state:'closed',head:{...pr.head,sha}},sha),/changed or closed/);
});

const job={job:{id:'job-1',kind:'implement'},sourceSha:'a'.repeat(40)};
const report={suites:[{file:'e2e/agent/blue.spec.js',specs:[{title:'mobile navigation',file:'e2e/agent/blue.spec.js',line:33,tests:[{projectName:'mobile',status:'unexpected',results:[{status:'failed',error:{message:'Expected: visible\nTickets link not found'}}]},{projectName:'desktop',status:'expected',results:[{status:'passed'}]}]}]}]};

test('verifier feedback preserves actual failing project, location and error without reporting passing tests',()=>{
  assert.deepEqual(browserFailures(report),[{file:'e2e/agent/blue.spec.js',line:33,project:'mobile',title:'mobile navigation',status:'unexpected',error:'Expected: visible\nTickets link not found'}]);
  const result=verificationReport(job,{validated:'success',check:'success',browser:'failure',report});
  assert.equal(result.repairable,true);assert.equal(result.verified,false);
  assert.match(result.summary,/blue.spec.js:33 \[mobile\]/);
  assert.match(result.summary,/Tickets link not found/);
  assert.equal(verificationReport(job,{validated:'failure',browser:'failure',report}).repairable,false);
  assert.equal(verificationReport(job,{validated:'success',check:'success',browser:'skipped'}).verified,false);
  const passing={stats:{expected:88,unexpected:0,skipped:0,flaky:0,duration:1000}};
  assert.equal(verificationReport(job,{validated:'success',check:'success',browser:'success',report:passing}).verified,true);
  for(const report of [undefined,{stats:{...passing.stats,skipped:1}},{stats:{...passing.stats,flaky:1}},{stats:{...passing.stats,expected:0}}]){
    const invalid=verificationReport(job,{validated:'success',check:'success',browser:'success',report});
    assert.equal(invalid.verified,false);assert.equal(invalid.repairable,false);
    assert.ok(invalid.failed.includes('browser report'));
  }
  assert.equal(verificationReport(job,{validated:'success',check:'failure',browser:'skipped'}).repairable,true);
  assert.equal(verificationReport(job,{validated:'success',check:'skipped',browser:'skipped'}).repairable,false);
});
test('feedback bounds untrusted errors, includes global and flaky failures, and ties public summaries to the job and run',()=>{
  const flaky=structuredClone(report);flaky.suites[0].specs[0].tests[0].status='flaky';
  flaky.suites[0].specs[0].tests[0].results.push({status:'passed'});
  assert.equal(browserFailures(flaky)[0].error,'Expected: visible\nTickets link not found');
  assert.equal(browserFailures({errors:[{message:'Configuration error'}]})[0].error,'Configuration error');
  const huge={errors:Array(100).fill({message:'\u001b[31m'+'x'.repeat(9000)})};
  const result=verificationReport(job,{validated:'success',check:'failure',report:huge,log:'y'.repeat(20000)});
  assert.equal(result.failures.length,12);assert.ok(result.failures.every(f=>f.error.length<=1200));
  assert.ok(result.summary.length<=3500);assert.equal(result.log.length,8000);assert.doesNotMatch(result.summary,/\u001b/);
  const saved={...result,runId:'123'};
  const context={jobId:'job-1',runId:'123',stages:{'verify-repair':{result:'failure'}}};
  assert.match(failureSummary(saved,context),/Verification failed/);
  assert.doesNotMatch(failureSummary({...saved,jobId:'other'},context),/Verification failed/);
  assert.doesNotMatch(failureSummary({...saved,runId:'456'},context),/Verification failed/);
  assert.match(failureSummary(undefined,context),/verify-repair/);
});

test('failed verification gets one isolated repair of the existing proposal before publication',async()=>{
  const {jobs}=parse(await readFile('.github/workflows/relay-agent.yml','utf8'));
  assert.ok(jobs.repair,'A failed candidate must get a bounded repair with its real verifier feedback.');
  assert.match(jobs.repair.if,/needs.verify.outputs.repairable == 'true'/);
  assert.deepEqual(jobs.repair.needs,['prepare','verify']);
  assert.deepEqual(jobs.repair.permissions,{contents:'read'});
  assert.doesNotMatch(JSON.stringify(jobs.repair),/RELAY_CALLBACK_SECRET|GH_TOKEN|CLOUDFLARE/);
  const commands=jobs.repair.steps.map(s=>s.run||'').join('\n');
  assert.match(commands,/git apply --index/);
  assert.doesNotMatch(commands,/npm |npx /);
  const downloads=jobs.repair.steps.filter(s=>s.uses?.startsWith('actions/download-artifact')).map(s=>s.with.name);
  assert.deepEqual(downloads,['relay-job','relay-proposal','relay-verification']);
  assert.deepEqual(jobs['verify-repair'].needs,['prepare','repair']);
  assert.deepEqual(jobs['verify-repair'].permissions,{contents:'read'});
  assert.doesNotMatch(JSON.stringify(jobs['verify-repair']),/secrets\./);
  for(const id of ['check','browser','evidence','regression']){
    assert.equal(jobs.verify.steps.find(step=>step.id===id)['continue-on-error'],true);
    assert.equal(jobs['verify-repair'].steps.find(step=>step.id===id)['continue-on-error'],undefined);
  }
  assert.match(jobs.verify.steps.find(step=>step.id==='browser').run,/--retries=0/);
  assert.match(jobs.publish.steps.find(step=>step.with?.name?.includes('relay-repair-proposal')).with.name,/needs.verify-repair.result == 'success'/);
  for(const name of ['publish','evidence-report']){
    assert.ok(jobs[name].needs.includes('verify-repair'));
    assert.match(jobs[name].if,/needs.verify.outputs.verified == 'true'/);
    assert.match(jobs[name].if,/needs.verify-repair.result == 'success'/);
  }
});
