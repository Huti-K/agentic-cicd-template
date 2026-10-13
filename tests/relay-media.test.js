import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMediaManifest,publishMedia} from '../scripts/relay/media.mjs';

test('verified scenario recordings publish as immutable assets and retries reuse matching bytes',async context=>{
  const root=await mkdtemp(join(tmpdir(),'relay-media-'));context.after(()=>rm(root,{recursive:true,force:true}));
  const results=join(root,'results'),output=join(root,'output');await mkdir(results);
  const video=join(results,'video.webm'),poster=join(results,'screenshot.png');
  await writeFile(video,Buffer.from('1a45dfa300000000','hex'));await writeFile(poster,Buffer.from('89504e470d0a1a0a','hex'));
  const report={stats:{expected:1},suites:[{specs:[{title:'Clear ticket filters',tests:[{projectName:'desktop',status:'expected',results:[{status:'passed',attachments:[{contentType:'video/webm',path:video},{contentType:'image/png',path:poster}]}]}]}]}]};
  const recordings=await createMediaManifest(report,{results,output});assert.equal(recordings.length,1);assert.equal(recordings[0].title,'Clear ticket filters');
  const sha='a'.repeat(40),manifest={recordings,headSha:sha,jobId:'job'},value={job:{id:'job'},ticket:{id:'RLY-9',headSha:sha}};
  const env={GITHUB_RUN_ID:'123',GITHUB_REPOSITORY:'owner/repo',GH_TOKEN:'fixture-only'};let release,uploads=0,deletes=0;
  const api={github:async(path,body,method)=>{if(path==='releases/1/assets?per_page=100')return release.assets;if(method==='DELETE'){deletes++;release.assets=release.assets.filter(asset=>path!=='releases/assets/'+asset.id);return null;}if(path==='releases/tags/relay-evidence-123'){if(!release){const e=Error('missing');e.status=404;throw e;}return release;}assert.equal(path,'releases');release={...body,id:1,assets:[]};return release;}};
  const fetcher=async(url,init)=>{
    assert.equal(new URL(url).origin,'https://uploads.github.com');assert.equal(init.redirect,'error');uploads++;
    const name=new URL(url).searchParams.get('name'),digest='sha256:'+name.match(/[a-f0-9]{64}/)[0];
    if(uploads===1){release.assets.push({id:99,state:'starter',name,size:0});return new Response(null,{status:502});}
    const asset={id:uploads,state:'uploaded',name,digest,size:init.body.length,content_type:init.headers['Content-Type']};release.assets.push(asset);return Response.json(asset);
  };
  const media=await publishMedia(api,value,manifest,{env,fetcher,directory:output});assert.equal(media[0].assetId,2);assert.equal(media[0].posterAssetId,3);assert.equal(deletes,1);
  await publishMedia(api,value,manifest,{env,fetcher,directory:output});assert.equal(uploads,3);assert.equal(deletes,1);
  recordings[0].video.file='../outside.webm';await assert.rejects(publishMedia(api,value,manifest,{env,fetcher,directory:output}),/filename/);
  report.suites[0].specs[0].tests[0].results[0].attachments[0].path=join(root,'escape.webm');await writeFile(join(root,'escape.webm'),Buffer.from('1a45dfa300000000','hex'));
  await assert.rejects(createMediaManifest(report,{results,output}),/directory/);
});
