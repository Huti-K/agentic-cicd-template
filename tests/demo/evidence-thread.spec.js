import {test,expect} from '@playwright/test';
import {installPlatformAPI,reviewDetailFixture,HEAD_SHA} from '../../e2e/helpers/platform-api.js';

function fixture(){
  const detail=reviewDetailFixture(),job=detail.jobs[0];
  job.evidence=[{kind:'artifact',title:'Browser report, videos and screenshots (ZIP)',url:detail.evidence[0].url,headSha:HEAD_SHA}];
  detail.comments.push({id:'result',authorId:'ai',kind:'evidence',body:job.summary,createdAt:job.updatedAt});
  return detail;
}
test('completed E2E results expose the run and recording download in the discussion',{tag:'@mobile'},async({page})=>{
  const detail=fixture();
  const api=await installPlatformAPI(page,{detail,authenticated:false});
  await page.goto('/#ticket/RLY-1');
  const result=page.locator('#comment-list').getByRole('region',{name:'E2E results'});
  await expect(result.getByRole('link',{name:'View test run'})).toHaveAttribute('href',detail.jobs[0].runUrl);
  await expect(result.getByRole('link',{name:/Browser report, videos/})).toHaveAttribute('href',detail.jobs[0].evidence[0].url);
  await expect(result).toContainText('Passed');
  await expect(result).toContainText('GitHub may ask you to sign in');
  await expect(page.locator('#comment-list .comment')).toHaveCount(2);
  expect(api.requests.every(request=>request.method==='GET')).toBe(true);
});
test('older evidence and failed runs remain distinct and unsafe attachments are inert',async({page})=>{
  const detail=fixture();
  detail.pullRequest.headSha='b'.repeat(40);detail.ticket.requestRevision=4;detail.jobs[0].requestRevision=3;
  detail.jobs[0].evidence[0].url='javascript:window.injected=true';
  detail.jobs[0].evidence[0].title='<img src=x onerror=window.injected=true>';
  const failed={...detail.jobs[0],id:'failure',status:'failed',summary:'Browser assertions failed.',updatedAt:'2026-10-12T11:00:00.000Z',evidence:[],runUrl:'https://github.com/Huti-K/agentic-cicd-template/actions/runs/999'};
  detail.jobs.unshift(failed);
  detail.comments.push({id:'failure-comment',authorId:'ai',kind:'agent',body:failed.summary,createdAt:failed.updatedAt});
  await installPlatformAPI(page,{detail});
  await page.goto('/#ticket/RLY-1');
  const results=page.locator('#comment-list').getByRole('region',{name:'E2E results'});
  await expect(results).toHaveCount(2);
  await expect(results.first()).toContainText('Earlier revision');
  await expect(results.first()).toContainText('Request changed');
  await expect(results.first()).toContainText('Evidence link unavailable');
  await expect(results.first().locator('img')).toHaveCount(0);
  await expect(results.last()).toContainText('Failed');
  await expect(results.last().getByRole('link')).toHaveCount(1);
  await expect(results.last().getByRole('link')).toHaveAttribute('href',failed.runUrl);
  expect(await page.evaluate(()=>window.injected)).toBeUndefined();
});

test('ticket recordings are playable inline with device, revision and honest failure feedback',{tag:'@mobile'},async({page})=>{
  const detail=fixture(),job=detail.jobs[0],id='12345678-1234-4234-9234-123456789abc';
  const video={id:'video-1',kind:'video',assetId:42,title:'Copy a ticket link',device:'desktop',headSha:HEAD_SHA,url:'/api/evidence/'+id+'/42.webm',poster:'/api/evidence/'+id+'/43.png'};
  job.evidence.unshift(video);job.requestRevision=3;detail.ticket.requestRevision=3;detail.evidence=job.evidence.map(item=>({...item,requestRevision:3}));
  const api=await installPlatformAPI(page,{detail,authenticated:false});
  await page.route('**/api/evidence/**',route=>route.fulfill({status:503,body:'Temporarily unavailable'}));
  await page.goto('/#ticket/RLY-1');
  const section=page.getByRole('region',{name:'Evidence',exact:true}),player=section.locator('video');
  await expect(player).toHaveAttribute('controls','');
  await expect(player).toHaveAttribute('preload','none');
  await expect(player).toHaveAttribute('src',new RegExp('/42.webm$'));
  await expect(section).toContainText('Desktop');await expect(section).toContainText('Passed');
  await expect(section).toContainText('Revision '+HEAD_SHA.slice(0,7));
  await expect(section).toContainText('1 recording');
  await expect(section).not.toContainText('Request changed');
  await expect(page.locator('#comment-list').getByRole('region',{name:'E2E results'})).not.toContainText('Request changed');
  await player.evaluate(video=>{video.load();});
  await expect(section).toContainText('This recording could not load');
  expect(api.requests.every(request=>request.method==='GET')).toBe(true);
});

test('recording playback and paused position survive ticket polling',{tag:'@mobile'},async({page})=>{
  const {readFile}=await import('node:fs/promises');
  // A small synthetic media fixture tests the player, never used as ticket evidence.
  const bytes=await readFile('tests/fixtures/playback.webm');
  const detail=fixture(),url='/api/evidence/12345678-1234-4234-9234-123456789abc/42.webm';
  const video={kind:'video',assetId:42,title:'Player continuity',device:'desktop',headSha:HEAD_SHA,url};
  detail.evidence=[video];detail.jobs[0].evidence=[video];
  const api=await installPlatformAPI(page,{detail,authenticated:false});
  await page.route('**'+url,route=>route.fulfill({contentType:'video/webm',body:bytes}));
  await page.goto('/#ticket/RLY-1');
  const player=page.getByRole('region',{name:'Evidence',exact:true}).locator('video');
  await player.evaluate(async video=>{video.muted=true;video.loop=true;window.recordingNode=video;await video.play();});
  await expect.poll(()=>player.evaluate(video=>video.currentTime)).toBeGreaterThan(.15);
  await player.evaluate(video=>video.pause());
  const time=await player.evaluate(video=>video.currentTime);
  const discussionPlayer=page.locator('#comment-list video');
  await discussionPlayer.evaluate(async video=>{video.muted=true;window.discussionNode=video;await video.play();});
  await expect.poll(()=>discussionPlayer.evaluate(video=>video.currentTime)).toBeGreaterThan(.15);
  await discussionPlayer.evaluate(video=>video.pause());
  api.detail.comments.push({id:'new-comment',authorId:'huti',kind:'comment',body:'Playback remains visible while this comment arrives.',createdAt:'2026-10-13T09:00:00Z'});
  api.detail.pullRequest.freshness={fetchedAt:'2026-10-13T10:00:00Z',cached:true};
  const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/tickets/RLY-1');
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await refreshed;
  await expect(page.locator('.pr-card, .detail-card').filter({hasText:'GitHub checked'}).first()).toContainText('GitHub checked');
  expect(await player.evaluate(video=>video===window.recordingNode)).toBe(true);
  expect(await player.evaluate(video=>video.currentTime)).toBeCloseTo(time,1);
  await expect(page.locator('#comment-list')).toContainText('Playback remains visible');
  expect(await discussionPlayer.evaluate(video=>video===window.discussionNode&&video.currentTime>0)).toBe(true);
  await player.evaluate(video=>video.play());
  api.detail.pullRequest.freshness.fetchedAt='2026-10-13T10:01:00Z';
  const again=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/tickets/RLY-1');
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await again;
  expect(await player.evaluate(video=>video===window.recordingNode&&!video.paused)).toBe(true);
  await player.evaluate(video=>video.pause());
});
