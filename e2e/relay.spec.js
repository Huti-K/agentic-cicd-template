import { test, expect } from '@playwright/test';

async function navigate(page,name) {
  const menu=page.getByRole('button',{name:'Open navigation',exact:true});
  if(await menu.isVisible())await menu.click();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:new RegExp('^'+name)}).click();
}
test('overview, projects and ticket filters are connected and render without page errors',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/showcase.html');
  await expect(page.getByRole('heading',{name:'Your work, connected.'})).toBeVisible();
  await expect(page.locator('.stats-grid')).toContainText('15');
  await navigate(page,'Projects');
  await page.locator('.project-card').filter({has:page.getByRole('heading',{name:'Atlas Mobile'})}).getByRole('button',{name:'View project'}).click();
  await expect(page.getByLabel('Filter by project')).toHaveValue('atlas');
  await expect(page.locator('.ticket-card')).toHaveCount(5);
  await page.getByRole('button',{name:'List',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search tickets'}).fill('OFFLINE');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('ATL-086');
  await page.getByRole('searchbox',{name:'Search tickets'}).fill('nothing matches');
  await expect(page.getByRole('heading',{name:'No tickets here'})).toBeVisible();
  await page.getByRole('button',{name:'Clear filters'}).first().click();
  await expect(page.locator('tbody tr')).toHaveCount(20);
  expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('create, edit and move a ticket; local persistence preserves plain text safely',async({page})=>{
  await page.goto('/showcase.html');
  await page.getByRole('button',{name:'New ticket',exact:true}).click();
  const form=page.getByRole('dialog',{name:'Ticket form'}),title='<img src=x onerror=alert(1)> A sample ticket';
  await form.getByLabel('Title',{exact:true}).fill(title);
  await form.getByLabel('Description',{exact:true}).fill('Acceptance criteria: saved on reload.');
  await form.getByLabel('Project',{exact:true}).selectOption('orbit');
  await form.getByLabel('Assignee',{exact:true}).selectOption('alex');
  await form.getByRole('button',{name:'Create ticket',exact:true}).click();
  const detail=page.getByRole('dialog',{name:'Ticket details'});
  await expect(detail.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await expect(detail.locator('img')).toHaveCount(0);
  await detail.getByLabel('Ticket status').selectOption('in_progress');
  await expect(detail.getByLabel('Ticket status')).toHaveValue('in_progress');
  await detail.getByRole('button',{name:'Edit ticket',exact:true}).click();
  await form.getByLabel('Priority',{exact:true}).selectOption('urgent');
  await form.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(detail.getByLabel('Ticket priority')).toHaveValue('urgent');
  await expect(detail.getByRole('link',{name:'Draft on GitHub'})).toHaveAttribute('href',/^https:\/\/github.com\/Huti-K\/agentic-cicd-template\/issues\/new\?/);
  await page.reload();
  await page.getByRole('searchbox',{name:'Search tickets'}).fill('A sample ticket');
  await page.locator('.ticket-card').click();
  await expect(detail.getByLabel('Ticket status')).toHaveValue('in_progress');
  await expect(detail.getByLabel('Ticket priority')).toHaveValue('urgent');
});
test('a bad sample PR cannot merge until fixed, checked and reviewed again',async({page})=>{
  await page.goto('/showcase.html#pull-requests');
  await page.getByRole('button',{name:'Reconcile saved trips after reconnecting',exact:true}).click();
  const detail=page.getByRole('dialog',{name:'Pull request details'});
  await expect(detail.getByRole('button',{name:'Merge sample PR'})).toBeDisabled();
  await detail.getByRole('button',{name:'Run agent review'}).click();
  await expect(detail).toContainText('Changes requested');
  await expect(detail).toContainText('src/sync/reconcile.ts:72');
  await detail.getByRole('button',{name:'Apply suggested fix'}).click();
  await detail.getByRole('button',{name:'Run checks',exact:true}).click();
  await expect(detail.getByRole('button',{name:'Merge sample PR'})).toBeDisabled();
  await detail.getByRole('button',{name:'Run agent review'}).click();
  await detail.getByRole('button',{name:'Merge sample PR'}).click();
  await expect(detail).toContainText('Merged');
  await detail.getByRole('button',{name:/ATL-086 · Handle offline/}).click();
  await expect(page.getByRole('dialog',{name:'Ticket details'}).getByLabel('Ticket status')).toHaveValue('done');
  await page.reload();
  await page.getByRole('button',{name:'Merged',exact:true}).click();
  await expect(page.getByRole('button',{name:'Reconcile saved trips after reconnecting',exact:true})).toBeVisible();
});
test('create a linked sample PR and protect the ticket from premature completion',async({page})=>{
  await page.goto('/showcase.html#tickets');
  await page.getByRole('searchbox',{name:'Search tickets'}).fill('ORB-140');
  await page.locator('.ticket-card').click();
  await page.getByRole('button',{name:'Create sample pull request'}).click();
  const detail=page.getByRole('dialog',{name:'Pull request details'});
  await expect(detail.getByRole('button',{name:'Merge sample PR'})).toBeDisabled();
  await detail.getByRole('button',{name:/ORB-140 ·/}).click();
  const ticket=page.getByRole('dialog',{name:'Ticket details'});
  await expect(ticket.getByLabel('Ticket status')).toHaveValue('in_review');
  await ticket.getByLabel('Ticket status').selectOption('done');
  await expect(ticket.getByRole('status')).toContainText('Merge the linked pull request');
  await expect(ticket.getByLabel('Ticket status')).toHaveValue('in_review');
});
test('reset is explicit and corrupted storage recovers',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('relay.workspace.v1','{broken'));
  await page.goto('/showcase.html');
  await expect(page.getByRole('status')).toContainText('could not be restored');
  const menu=page.getByRole('button',{name:'Open navigation',exact:true});
  if(await menu.isVisible())await menu.click();
  await page.getByRole('button',{name:'Reset sample data',exact:true}).click();
  const reset=page.getByRole('dialog',{name:'Reset sample workspace'});
  await expect(reset).toBeVisible();
  await reset.getByRole('button',{name:'Keep my changes'}).click();
  await expect(reset).not.toBeVisible();
  await page.getByRole('button',{name:'Reset sample data',exact:true}).click();
  await reset.getByRole('button',{name:'Reset sample data',exact:true}).click();
  await expect(page.locator('.stat-number').first()).toHaveText('15');
});

const repo='Huti-K/agentic-cicd-template',sha='a'.repeat(40);
async function stubGitHub(page) {
  const item={number:42,title:'Fix ticket status transitions',state:'open',body:'Real issue description',user:{login:'huti'},labels:[{name:'agent-ready'}],updated_at:'2026-10-11T10:00:00Z'};
  const pr={...item,number:43,title:'Guard ticket completion',head:{sha,ref:'fix/tickets'},base:{ref:'main'},html_url:'javascript:alert(1)'};
  await page.route('https://api.github.com/repos/**',route=>{
    const path=new URL(route.request().url()).pathname;
    const data=path.endsWith('/reviews')?[{user:{login:'reviewer'},state:'CHANGES_REQUESTED',body:'Preserve ticket links.'}]:
      path.endsWith('/comments')?[{user:{login:'github-actions[bot]'},body:'Agent review: <img src=x onerror=alert(1)> Check the linked PR.',updated_at:item.updated_at}]:
      path.endsWith('/check-runs')?{check_runs:[{name:'verify',status:'completed',conclusion:'success'}],total_count:1}:
      path.endsWith('/status')?{statuses:[{context:'AI review',state:'failure'}],total_count:1}:
      path.endsWith('/pulls/43')?pr:path.endsWith('/pulls')?[pr]:
      path.endsWith('/issues')?[item,{...pr,pull_request:{}}]:
      path.endsWith('/actions/runs')?{workflow_runs:[{id:123,name:'CI',display_title:'Verify ticket workflow',status:'completed',conclusion:'success',head_branch:'main',created_at:item.updated_at}]}:
      {description:'A real repository'};
    return route.fulfill({json:data});
  });
}
test('GitHub shows live issues, PR checks and agent feedback with safe external actions',async({page})=>{
  const requests=[];page.on('request',request=>{if(request.url().startsWith('https://api.github.com/'))requests.push(request);});
  await stubGitHub(page);await page.goto('/showcase.html#github');
  await expect(page.getByRole('button',{name:'Fix ticket status transitions',exact:true})).toBeVisible();
  await expect(page.locator('.live-card')).toHaveCount(1);
  await page.getByRole('button',{name:/Pull requests · 1/}).click();
  await page.getByRole('button',{name:'Guard ticket completion',exact:true}).click();
  const detail=page.getByRole('dialog',{name:'GitHub details'});
  await expect(detail).toContainText('verify');
  await expect(detail).toContainText('AI review');
  await expect(detail).toContainText('Agent review: <img src=x onerror=alert(1)>');
  await expect(detail.locator('img')).toHaveCount(0);
  await expect(detail.getByRole('link',{name:'Review or merge on GitHub'})).toHaveAttribute('href','https://github.com/'+repo+'/pull/43');
  await detail.getByRole('button',{name:'Close GitHub pull request #43'}).click();
  await page.getByRole('button',{name:'Workflow runs'}).click();
  await expect(page.getByRole('link',{name:'Verify ticket workflow'})).toHaveAttribute('href','https://github.com/'+repo+'/actions/runs/123');
  for(const request of requests){expect(request.method()).toBe('GET');expect(request.headers().authorization).toBeUndefined();}
});
test('GitHub keeps the last successful data visible on an API outage',async({page})=>{
  await stubGitHub(page);await page.goto('/showcase.html#github');
  await expect(page.getByRole('button',{name:'Fix ticket status transitions',exact:true})).toBeVisible();
  await page.route('https://api.github.com/repos/**',route=>route.fulfill({status:403,json:{message:'rate limit'}}));
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.locator('.connection-status')).toContainText('rate limited');
  await expect(page.locator('.connection-status')).toContainText('last successful snapshot');
  await expect(page.getByRole('button',{name:'Fix ticket status transitions',exact:true})).toBeVisible();
});
test('the pipeline page renders run data and handles API outages',async({page})=>{
  await page.route('https://api.github.com/repos/**/actions/runs?*',route=>route.fulfill({json:{
    workflow_runs:[{name:'CI',display_title:'Verify Relay workspace',status:'completed',conclusion:'success',
      html_url:'https://github.com/'+repo+'/actions/runs/123',head_branch:'main',head_sha:sha,created_at:'2026-10-11T09:00:00Z'}],
  }}));
  await page.goto('/pipeline.html');
  await expect(page.locator('#runs')).toContainText('Verify Relay workspace');
  await expect(page.locator('#runs')).toContainText('Passed');
  await expect(page.locator('#build-commit')).not.toHaveText('Loading…');
  await page.route('https://api.github.com/repos/**/actions/runs?*',route=>route.fulfill({status:403,json:{message:'Rate limit'}}));
  await page.getByRole('button',{name:'Refresh runs'}).click();
  await expect(page.getByRole('status')).toContainText('unavailable');
});
