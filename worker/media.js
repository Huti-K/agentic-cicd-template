import {assert,text} from './model.js';

const MAX_BYTES=25*1024*1024;
const mediaPath=(job,id,extension)=>'/api/evidence/'+job.id+'/'+id+'.'+extension;
export async function publishedMedia(entries,job,github){
  assert(Array.isArray(entries)&&entries.length>=1&&entries.length<=8,'Supply 1–8 recorded scenarios.');
  const release=await github.call('/releases/tags/relay-evidence-'+job.runId);
  assert(!release.draft&&release.tag_name==='relay-evidence-'+job.runId&&release.target_commitish===job.headSha,'Recordings must belong to this run and revision.');
  const seen=new Set();
  const asset=(id,extension,digest)=>{
    assert(Number.isSafeInteger(id)&&id>0&&!seen.has(id),'Invalid or duplicate recording asset.');seen.add(id);
    const found=release.assets?.find(item=>item.id===id);
    assert(found&&found.state==='uploaded'&&found.size>0&&found.size<=MAX_BYTES&&found.content_type===(extension==='webm'?'video/webm':'image/png')&&/^sha256:[a-f0-9]{64}$/.test(digest||'')&&found.digest===digest&&found.name.endsWith('-'+digest.slice(7)+'.'+extension),'Recording asset failed validation.');
    return found;
  };
  return entries.map(item=>{
    assert(item&&['desktop','mobile'].includes(item.device),'Invalid recording device.');
    asset(item.assetId,'webm',item.digest);asset(item.posterAssetId,'png',item.posterDigest);
    return {id:crypto.randomUUID(),kind:'video',title:text(item.title,160,'Scenario title'),device:item.device,result:'passed',mode:'fixture-backed-browser',assetId:item.assetId,posterAssetId:item.posterAssetId,url:mediaPath(job,item.assetId,'webm'),poster:mediaPath(job,item.posterAssetId,'png'),headSha:job.headSha};
  });
}

async function mediaSource(store,github,assetId,range){
  const key='media-source:'+github.repository+':'+assetId,timestamp=Date.now();
  const cached=await store.metadata(key);
  if(cached?.expiresAt>timestamp){assert(!cached.error,'Recording download is temporarily unavailable. Retry shortly.',503);return {location:cached.location};}
  const owner=crypto.randomUUID();
  const lease=await store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=json_set(metadata.value,'$.owner',?,'$.until',?) WHERE COALESCE(json_extract(metadata.value,'$.expiresAt'),0)<? AND COALESCE(json_extract(metadata.value,'$.until'),0)<? RETURNING value")
    .bind(key,JSON.stringify({owner,until:timestamp+20000}),owner,timestamp+20000,timestamp,timestamp).first();
  if(!lease){
    for(let attempt=0;attempt<20;attempt++){
      await new Promise(resolve=>setTimeout(resolve,50));
      const latest=await store.metadata(key);
      if(latest?.expiresAt>Date.now()){assert(!latest.error,'Recording download is temporarily unavailable. Retry shortly.',503);return {location:latest.location};}
    }
    assert(false,'Recording download is refreshing. Retry shortly.',503);
  }
  try{
    // Media must not exhaust the credential shared by ticket reads and writes.
    await store.rate('github-media-downloads',400,3600);
    const response=await github.fetcher('https://api.github.com/repos/'+github.repository+'/releases/assets/'+assetId,{headers:{Accept:'application/octet-stream','User-Agent':'Relay-evidence',Authorization:'Bearer '+github.env.GITHUB_TOKEN,'X-GitHub-Api-Version':'2022-11-28',...(range?{Range:range}:{})},redirect:'manual',signal:AbortSignal.timeout(15000)});
    if(response.status===302){
      let target;try{target=new URL(response.headers.get('Location'));}catch{assert(false,'Recording download is unavailable.',502);}
      assert(target.protocol==='https:'&&!target.username&&!target.password&&['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(target.hostname),'Unexpected recording download host.',502);
      await store.setMetadata(key,{location:target.href,expiresAt:Date.now()+60000,until:0});
      return {location:target.href};
    }
    assert([200,206,416].includes(response.status),'The recording is temporarily unavailable. Try again or open the full report.',response.status===404?404:502);
    await store.setMetadata(key,{expiresAt:0,until:0});return {response};
  }catch(error){await store.setMetadata(key,{error:true,expiresAt:Date.now()+15000,until:0});throw error;}
}

export async function serveMedia(request,store,github,jobId,assetId,extension){
  const job=await store.job(jobId);
  assert(job.kind==='evidence'&&job.status==='succeeded'&&(job.evidence||[]).some(item=>item.kind==='video'&&(extension==='webm'?item.assetId===assetId:item.posterAssetId===assetId)),'Recording not found.',404);
  const range=request.headers.get('Range');
  assert(!range||/^bytes=(?:\d+-\d*|-\d+)$/.test(range),'Use a single byte range.',416);
  const source=await mediaSource(store,github,assetId,range);
  // The signed asset URL is sufficient. Never send the API credential to it.
  const response=source.response||await github.fetcher(source.location,{headers:range?{Range:range}:{},redirect:'manual',signal:AbortSignal.timeout(20000)});
  const resultHeaders=new Headers({'Content-Type':extension==='webm'?'video/webm':'image/png','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=3600','Accept-Ranges':'bytes','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'inline'});
  if(response.status===416){if(response.headers.has('Content-Range'))resultHeaders.set('Content-Range',response.headers.get('Content-Range'));return new Response(null,{status:416,headers:resultHeaders});}
  assert([200,206].includes(response.status),'The recording is temporarily unavailable. Try again or open the full report.',response.status===404?404:502);
  for(const header of ['Content-Range','Content-Length','ETag','Last-Modified'])if(response.headers.has(header))resultHeaders.set(header,response.headers.get(header));
  if(request.method==='HEAD'){await response.body?.cancel();return new Response(null,{headers:resultHeaders,status:response.status});}
  return new Response(response.body,{headers:resultHeaders,status:response.status});
}
