import {test,expect} from '@playwright/test';
import {installPlatformAPI,reviewDetailFixture,HEAD_SHA} from '../../e2e/helpers/platform-api.js';

function fixture(){
  const detail=reviewDetailFixture(),job=detail.jobs[0];
  job.evidence=[{kind:'artifact',title:'Browser report, videos and screenshots (ZIP)',url:detail.evidence[0].url,headSha:HEAD_SHA}];
  detail.comments.push({id:'result',authorId:'ai',kind:'evidence',body:job.summary,createdAt:job.updatedAt});
  return detail;
}
test('completed E2E results expose the run and recording download in the discussion',async({page})=>{
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
  detail.pullRequest.headSha='b'.repeat(40);
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
  await expect(results.first()).toContainText('Evidence link unavailable');
  await expect(results.first().locator('img')).toHaveCount(0);
  await expect(results.last()).toContainText('Failed');
  await expect(results.last().getByRole('link')).toHaveCount(1);
  await expect(results.last().getByRole('link')).toHaveAttribute('href',failed.runUrl);
  expect(await page.evaluate(()=>window.injected)).toBeUndefined();
});
