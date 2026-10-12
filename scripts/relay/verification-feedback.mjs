import {readFile,writeFile,appendFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {evidenceSummary} from './policy.mjs';

const clean=(value,limit=1200)=>String(value||'').replace(/\x1b\[[0-9;]*m/g,'').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'').slice(0,limit);
export function browserFailures(report){
  const failures=[];
  function visit(suites){
    for(const suite of suites||[]){
      for(const spec of suite.specs||[])for(const test of spec.tests||[]){
        if(!['unexpected','flaky'].includes(test.status))continue;
        const result=[...(test.results||[])].reverse().find(result=>['failed','timedOut','interrupted'].includes(result.status));
        failures.push({file:clean(spec.file||suite.file,250),line:spec.line,project:clean(test.projectName,80),title:clean(spec.title,300),status:test.status,error:clean(result?.error?.message||result?.errors?.[0]?.message||test.status)});
      }
      visit(suite.suites);
    }
  }
  visit(report?.suites);
  for(const error of report?.errors||[])failures.push({title:'Browser runner',error:clean(error.message)});
  return failures.slice(0,12);
}
export function verificationReport(job,{check='',browser='',regression='',validated='',report,log=''}={}){
  const failed=[['regression',regression],['checks',check],['browser',browser]].filter(([,status])=>status==='failure').map(([name])=>name);
  const failures=browserFailures(report);
  let reportValid=false;
  if(browser==='success'){
    try{evidenceSummary(report);reportValid=true;}catch(error){failed.push('browser report');failures.push({title:'Browser report validation',error:clean(error.message)});}
  }
  const summary=failed.length?`Verification failed: ${failed.join(', ')}.\n`+failures.slice(0,4).map(f=>`${f.file||''}:${f.line||''} [${f.project||'runner'}] ${f.title}\n${f.error}`).join('\n\n'):'Verification completed without a repairable test failure.';
  return {jobId:job.job.id,sourceSha:job.sourceSha,kind:job.job.kind,runId:String(process.env.GITHUB_RUN_ID||''),repairable:validated==='success'&&failed.some(stage=>['checks','browser','regression'].includes(stage)),verified:validated==='success'&&check==='success'&&browser==='success'&&regression!=='failure'&&reportValid,failed,failures,summary:clean(summary,3500),log:clean(log.slice(-8000),8000)};
}
export function failureSummary(report,{jobId,runId,stages={}}){
  const failed=Object.entries(stages).filter(([,value])=>['failure','cancelled'].includes(value?.result)).map(([name])=>clean(name,60));
  const stageText=failed.length?`Automation stopped at: ${failed.join(', ')}.`:'Automation did not complete.';
  if(report?.jobId!==jobId||String(report?.runId)!==String(runId)||!Array.isArray(report?.failed)||!report.failed.length||typeof report.summary!=='string')return stageText+' Open the linked run for details.';
  return clean(stageText+'\n'+report.summary,3900);
}
export async function writeFeedback(){
  const job=JSON.parse(await readFile('.agent-output/job.json','utf8'));
  const optional=async path=>{try{return await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return '';throw error;}};
  const raw=await optional(job.job.kind==='evidence'?'.agent-output/browser-results.json':'.agent-output/implementation-results.json');
  let report;try{report=raw?JSON.parse(raw):undefined;}catch{/* A truncated runner report is still a failure, never a pass. */}
  const log=await optional('.agent-output/check.log');
  const value=verificationReport(job,{report,log,validated:process.env.VALIDATE_RESULT,check:process.env.CHECK_RESULT,browser:process.env.BROWSER_RESULT,regression:process.env.REGRESSION_RESULT});
  await mkdir('.agent-output',{recursive:true});
  await writeFile('.agent-output/verification.json',JSON.stringify(value,null,2)+'\n');
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`repairable=${value.repairable}\nverified=${value.verified}\n`);
  return value;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await writeFeedback();
