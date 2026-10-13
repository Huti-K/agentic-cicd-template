import {mkdir,readFile,writeFile,realpath,lstat} from 'node:fs/promises';
import {resolve,relative,basename} from 'node:path';
import {createHash} from 'node:crypto';

const MAX_BYTES=25*1024*1024;
const digest=data=>'sha256:'+createHash('sha256').update(data).digest('hex');
async function recordingFile(root,path,extension){
  const base=await realpath(root),file=resolve(path),actual=await realpath(file);
  const inside=relative(base,actual);
  if(inside.startsWith('..')||resolve(base,inside)!==actual||!(await lstat(file)).isFile())throw Error('Recording path leaves the verified output directory.');
  const stat=await lstat(file);
  if(stat.size<8||stat.size>MAX_BYTES)throw Error('Recording exceeds the 25 MB limit or is empty.');
  const data=await readFile(file),magic=extension==='webm'?'1a45dfa3':'89504e470d0a1a0a';
  if(data.subarray(0,magic.length/2).toString('hex')!==magic)throw Error('Recording has an invalid media signature.');
  return {data,digest:digest(data)};
}
export async function createMediaManifest(report,{results='.agent-output/browser-results',output='.agent-output/recorded-media'}={}){
  const recordings=[];await mkdir(output,{recursive:true});
  async function visit(suite){
    for(const spec of suite.specs||[])for(const test of spec.tests||[]){
      if(!['desktop','mobile'].includes(test.projectName)||test.status!=='expected'||test.results?.length!==1||test.results[0].status!=='passed')throw Error('Only passing first-attempt recordings can be published.');
      const attachments=test.results[0].attachments||[],video=attachments.find(a=>a.contentType==='video/webm'),poster=attachments.find(a=>a.contentType==='image/png');
      if(!video?.path||!poster?.path||recordings.length>=8)throw Error('Each scenario needs video and screenshot evidence (maximum 8).');
      const entry={title:String(spec.title).slice(0,160),device:test.projectName};
      for(const [kind,source,extension] of [['video',video.path,'webm'],['poster',poster.path,'png']]){
        const file=await recordingFile(results,source,extension),name=kind+'-'+String(recordings.length+1).padStart(2,'0')+'-'+file.digest.slice(7)+'.'+extension;
        await writeFile(resolve(output,name),file.data);
        entry[kind]={file:name,digest:file.digest};
      }
      recordings.push(entry);
    }
    for(const child of suite.suites||[])await visit(child);
  }
  for(const suite of report.suites||[])await visit(suite);
  if(recordings.length!==report.stats?.expected||!recordings.length)throw Error('Recording count does not match passing tests.');
  return recordings;
}
export async function publishMedia(api,value,manifest,{env=process.env,fetcher=fetch,directory='.agent-output/recorded-media'}={}){
  const run=env.GITHUB_RUN_ID,repository=env.GITHUB_REPOSITORY;
  if(!/^[1-9]\d*$/.test(run||'')||!/^[\w.-]+\/[\w.-]+$/.test(repository||'')||!/^[a-f0-9]{40}$/.test(value.ticket.headSha||'')||manifest.headSha!==value.ticket.headSha||manifest.jobId!==value.job.id)throw Error('Invalid publication context.');
  if(!Array.isArray(manifest.recordings)||manifest.recordings.length<1||manifest.recordings.length>8)throw Error('Missing bounded scenario recordings.');
  // Validate every byte and path before obtaining any GitHub write result.
  const files=[];
  for(const item of manifest.recordings){
    if(!['desktop','mobile'].includes(item.device)||typeof item.title!=='string'||!item.title||item.title.length>160)throw Error('Invalid scenario metadata.');
    for(const [kind,extension] of [['video','webm'],['poster','png']]){
      const part=item[kind];
      if(!part||typeof part.file!=='string'||basename(part.file)!==part.file||!new RegExp('^'+kind+'-\\d{2}-[a-f0-9]{64}\\.'+extension+'$').test(part.file))throw Error('Invalid recording filename.');
      const data=await recordingFile(directory,resolve(directory,part.file),extension);
      if(data.digest!==part.digest||!part.file.endsWith(data.digest.slice(7)+'.'+extension))throw Error('Recording digest changed.');
      files.push({part,data:data.data,type:extension==='webm'?'video/webm':'image/png'});
    }
  }
  const tag='relay-evidence-'+run;
  let release;
  try{release=await api.github('releases/tags/'+tag);}catch(error){if(error.status!==404)throw error;}
  if(!release)release=await api.github('releases',{tag_name:tag,target_commitish:manifest.headSha,name:value.ticket.id+' · browser evidence · '+run,body:'Recorded browser scenarios for '+value.ticket.id+' at revision '+manifest.headSha+'. These use controlled fixtures; they are not production customer sessions.',prerelease:true,make_latest:'false'});
  if(release.draft||release.target_commitish!==manifest.headSha||release.tag_name!==tag||!Number.isSafeInteger(release.id))throw Error('Evidence release does not match this revision.');
  const assets=[];
  for(const file of files){
    let asset=release.assets?.find(item=>item.name===file.part.file);
    if(!asset){
      const url='https://uploads.github.com/repos/'+repository+'/releases/'+release.id+'/assets?name='+encodeURIComponent(file.part.file);
      const response=await fetcher(url,{method:'POST',headers:{Authorization:'Bearer '+env.GH_TOKEN,Accept:'application/vnd.github+json','Content-Type':file.type,'X-GitHub-Api-Version':'2022-11-28'},body:file.data,redirect:'error',signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw Error('Recording upload failed ('+response.status+').');
      asset=await response.json();
    }
    if(!Number.isSafeInteger(asset.id)||asset.state!=='uploaded'||asset.digest!==file.part.digest||asset.size!==file.data.length||asset.content_type!==file.type)throw Error('Uploaded recording did not match the verified file.');
    assets.push(asset);
  }
  return manifest.recordings.map((item,i)=>({title:item.title,device:item.device,assetId:assets[2*i].id,digest:item.video.digest,posterAssetId:assets[2*i+1].id,posterDigest:item.poster.digest}));
}
