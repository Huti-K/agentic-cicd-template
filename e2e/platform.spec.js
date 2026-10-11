import { test, expect } from '@playwright/test';
import { installPlatformAPI, reviewDetailFixture, ticketFixture, HEAD_SHA } from './helpers/platform-api.js';

test('all tickets remain discoverable beyond the recent workspace page with accurate counts and retryable paging', async ({ page }) => {
  const api=await installPlatformAPI(page);
  api.tickets=Array.from({length:205},(_,index)=>ticketFixture({id:'RLY-'+(index+2),title:index?'Shipped request '+(index+2):'Historic keyboard defect',status:index?'deployed':'in_review',priority:'high'}));
  await page.goto('/');
  const stats=page.getByRole('region',{name:'Workspace statistics'});
  await expect(stats.locator('article').filter({hasText:'Open tickets'}).locator('.stat-number')).toHaveText('2');
  await expect(stats.locator('article').filter({hasText:'Shipped'}).locator('.stat-number')).toHaveText('204');
  await expect(page.getByRole('button',{name:'Historic keyboard defect',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'All tickets',exact:true}).click();
  const list=page.getByRole('region',{name:'Tickets',exact:true});
  await expect(list).toContainText('Showing 50 of 206 tickets');
  api.failure={path:'/api/tickets',method:'GET',error:'Ticket page temporarily unavailable.'};
  await page.getByRole('button',{name:'Load more tickets',exact:true}).click();
  await expect(list).toContainText('Ticket page temporarily unavailable.');
  await expect(list.locator('.ticket-line')).toHaveCount(50);
  api.failure=null;
  await page.getByRole('button',{name:'Retry ticket page',exact:true}).click();
  await expect(list).toContainText('Showing 100 of 206 tickets');
  api.holdTicketQuery='Shipped request';
  await page.getByLabel('Search tickets',{exact:true}).fill('Shipped request');
  await expect.poll(()=>typeof api.releaseTicketPage).toBe('function');
  await page.getByLabel('Search tickets',{exact:true}).fill('Historic keyboard');
  await expect(list).toContainText('Showing 1 of 1 ticket');
  const staleResponse=page.waitForResponse(response=>response.url().includes('query=Shipped+request'));
  api.releaseTicketPage();await staleResponse;
  await expect(list).toContainText('Showing 1 of 1 ticket');
  await page.getByLabel('Filter by status',{exact:true}).selectOption('in_review');
  await page.getByLabel('Filter by priority',{exact:true}).selectOption('high');
  await expect(list.getByRole('button',{name:'Historic keyboard defect',exact:true})).toBeVisible();
  await expect(page.getByLabel('Search tickets',{exact:true})).toHaveValue('Historic keyboard');
  await page.getByRole('button',{name:'Clear',exact:true}).click();
  await expect(list).toContainText('Showing 50 of 206 tickets');
  api.tickets.push(ticketFixture({id:'RLY-207',title:'New arrival'}));
  await page.getByRole('button',{name:'Refresh tickets',exact:true}).click();
  await expect(list).toContainText('Showing 50 of 207 tickets');
  await expect(list.getByRole('button',{name:'New arrival',exact:true})).toBeVisible();
  expect(api.requests.filter(r=>r.path==='/api/tickets'&&r.method==='GET').length).toBeGreaterThan(3);
});

for (const linkedPR of [false, true]) test('saved request retry names the agent action accurately '+(linkedPR?'with PR':'before PR'), async ({ page }) => {
  const api = await installPlatformAPI(page);
  if (linkedPR) Object.assign(api.detail, reviewDetailFixture());
  api.detail.ticket.pendingAgent = { id: 'saved-request' };
  await page.goto('/#ticket/RLY-1');
  await expect(page.getByText('Your request is saved. Retry it to start the next agent run.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate evidence', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start implementation', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry saved request', exact: true }).click();
  expect(api.requests.find(request => request.path.endsWith('/actions')).body.action).toBe(linkedPR?'implement':'triage');
});

test('saved request during an active run explains the automatic follow-up without offering a retry', async ({ page }) => {
  const api = await installPlatformAPI(page);
  Object.assign(api.detail, reviewDetailFixture());
  api.detail.ticket.pendingAgent = { id: 'saved-request' };
  api.detail.jobs.unshift({ id:'active-job',kind:'implement',status:'running',createdAt:new Date().toISOString() });
  await page.goto('/#ticket/RLY-1');
  await expect(page.getByText('Your request is saved. One follow-up agent will start after the current run finishes.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry saved request', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate evidence', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve and merge', exact: true })).toBeDisabled();
});

test('an interrupted dispatch becomes resumable after its lease expires without replacing the job or discussion draft', async ({ page }) => {
  const api=await installPlatformAPI(page),now=Date.now();
  await page.clock.install({time:new Date(now)});
  Object.assign(api.detail.ticket,{status:'triaging',activeJobId:'queued-original'});
  api.detail.jobs=[{id:'queued-original',ticketId:'RLY-1',kind:'triage',status:'queued',runId:null,dispatchState:'pending',dispatchUntil:now+30000,createdAt:new Date(now).toISOString()}];
  await page.goto('/#ticket/RLY-1');
  const draft=page.getByLabel('Write a comment',{exact:true});
  await draft.fill('Keep these reproduction details while reconnecting.');
  await draft.evaluate(node=>node.setSelectionRange(4,10));
  await expect(page.getByText('Waiting for GitHub dispatch confirmation. Recovery will be available when this attempt times out.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Resume queued agent',exact:true})).toHaveCount(0);
  await page.clock.fastForward(32000);
  const resume=page.getByRole('button',{name:'Resume queued agent',exact:true});
  await expect(resume).toBeEnabled();
  await expect(draft).toBeFocused();
  expect(await draft.evaluate(node=>[node.selectionStart,node.selectionEnd])).toEqual([4,10]);
  await resume.click();
  await expect(resume).toHaveCount(0);
  await expect(draft).toHaveValue('Keep these reproduction details while reconnecting.');
  expect(api.detail.jobs).toHaveLength(1);
  expect(api.detail.jobs[0]).toMatchObject({id:'queued-original',dispatchState:'accepted'});
  expect(api.requests.filter(request=>request.method==='POST')).toHaveLength(1);
  expect(api.requests.find(request=>request.method==='POST').body.action).toBe('triage');
});

test('public ticket view exposes properties and discussion while protecting maintainer actions', async ({ page }) => {
  const api = await installPlatformAPI(page, { authenticated: false });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#ticket/RLY-1');
  await expect(page.getByRole('heading', { name: api.detail.ticket.title, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Description', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Discussion', exact: true })).toBeVisible();
  await expect(page.getByText('I can help reproduce this on mobile.', { exact: true })).toBeVisible();
  const post = page.getByRole('button', { name: 'Post comment', exact: true });
  if (await post.isVisible()) await expect(post).toBeDisabled();
  const triage = page.getByRole('button', { name: 'Start triage', exact: true });
  if (await triage.isVisible() && await triage.isEnabled()) {
    await triage.click();
    await expect(page.getByRole('dialog', { name: 'Maintainer sign-in' })).toBeVisible();
  }
  expect(api.requests.filter(request => request.method !== 'GET')).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('issue connection recovery requires maintainer confirmation and never starts an agent', async ({ page }) => {
  const api=await installPlatformAPI(page,{authenticated:false});
  Object.assign(api.detail.ticket,{status:'human_edit',issueNumber:null,issueUrl:null,error:'The previous issue creation is uncertain.'});
  await page.goto('/#ticket/RLY-1');
  await page.getByRole('button',{name:'Retry GitHub connection',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Maintainer sign-in'})).toBeVisible();
  expect(api.requests.filter(r=>r.method==='POST')).toHaveLength(0);
  api.authenticated=true;await page.reload();
  await page.getByRole('button',{name:'Retry GitHub connection',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Retry GitHub connection',exact:true});
  await expect(dialog).toContainText('checks for an existing issue first');
  await expect(dialog).toContainText('uncertain');
  expect(api.requests.filter(r=>r.method==='POST')).toHaveLength(0);
  api.failure={path:'/api/tickets/RLY-1/actions',method:'POST',error:'GitHub is still unavailable.'};
  await dialog.getByRole('button',{name:'Confirm issue recovery',exact:true}).click();
  await expect(dialog).toContainText('GitHub is still unavailable.');
  api.failure=null;
  await dialog.getByRole('button',{name:'Confirm issue recovery',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  expect(api.requests.filter(r=>r.method==='POST').every(r=>r.body.action==='retry-issue'&&r.body.confirmRetry===true)).toBe(true);
  expect(api.detail.ticket.status).toBe('human_edit');
  expect(api.detail.jobs).toHaveLength(0);
  await expect(page.getByRole('button',{name:'Retry GitHub connection',exact:true})).toHaveCount(0);
});

test('maintainer sign-in handles failure then sends CSRF-protected ticket writes', async ({ page }) => {
  const api = await installPlatformAPI(page, { authenticated: false });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  const signIn = page.getByRole('dialog', { name: 'Maintainer sign-in' });
  await signIn.getByLabel('Password', { exact: true }).fill('wrong-password');
  await signIn.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(signIn).toContainText('Invalid maintainer password.');
  await signIn.getByLabel('Password', { exact: true }).fill('demo-password');
  await signIn.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(signIn).not.toBeVisible();
  await page.getByRole('button', { name: 'New ticket', exact: true }).first().click();
  const form = page.getByRole('dialog', { name: 'New ticket', exact: true });
  await form.getByLabel('Title', { exact: true }).fill('Keep uploaded screenshots available');
  await form.getByLabel('Description', { exact: true }).fill('Screenshots should stay attached to the ticket after refresh.');
  await form.getByLabel('Type', { exact: true }).selectOption('feature');
  await form.getByLabel('Priority', { exact: true }).selectOption('high');
  await form.getByLabel('Tags (comma separated)', { exact: true }).fill('uploads, support');
  await form.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep uploaded screenshots available', exact: true })).toBeVisible();
  const request = api.requests.find(request => request.path === '/api/tickets' && request.method === 'POST');
  expect(request.headers['x-csrf-token']).toBe(api.csrfToken);
  expect(request.body).toMatchObject({ type: 'feature', priority: 'high', tags: ['uploads', 'support'] });
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('demo-password');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(api.csrfToken);
});

test('editing preserves a draft when another editor has changed the ticket', async ({ page }) => {
  const api = await installPlatformAPI(page);
  await page.goto('/#ticket/RLY-1');
  await page.getByRole('button', { name: 'Edit ticket', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Edit ticket', exact: true });
  await form.getByLabel('Description', { exact: true }).fill('A carefully written draft that must not disappear.');
  api.conflict = true;
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(form).toBeVisible();
  await expect(form).toContainText('This ticket changed.');
  await expect(form.getByLabel('Description', { exact: true })).toHaveValue('A carefully written draft that must not disappear.');
  const request = api.requests.find(request => request.method === 'PATCH');
  expect(request.body.version).toBe(1);
  api.conflict = false;
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(page.getByText('A carefully written draft that must not disappear.', { exact: true })).toBeVisible();
});

test('mention suggestions add a contributor and mentioning AI requests a triage run', async ({ page }) => {
  const api = await installPlatformAPI(page);
  await page.goto('/#ticket/RLY-1');
  const composer = page.getByLabel('Write a comment', { exact: true });
  await composer.fill('@dav');
  const suggestions = page.getByRole('listbox', { name: 'Mention a contributor' });
  await expect(suggestions).toBeVisible();
  await suggestions.getByRole('option', { name: /David Mikan/ }).click();
  await expect(composer).toHaveValue(/@davidmikan/);
  await composer.fill('@davidmikan please investigate. @ai triage the missing draft.');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByText('@davidmikan please investigate. @ai triage the missing draft.', { exact: true })).toBeVisible();
  await expect(composer).toHaveValue('');
  expect(api.detail.ticket.contributorIds).toEqual(['huti', 'davidmikan', 'ai']);
  expect(api.detail.jobs[0]).toMatchObject({ kind: 'triage', status: 'queued' });
  expect(api.requests.find(request => request.path.endsWith('/comments')).body).toMatchObject({ body: '@davidmikan please investigate. @ai triage the missing draft.' });
  await expect(page.getByText('David Mikan', { exact: true }).first()).toBeVisible();
});

test('contributors can be mentioned using only the keyboard without posting the unfinished comment', async ({ page }) => {
  const api = await installPlatformAPI(page);
  await page.goto('/#ticket/RLY-1');
  const composer = page.getByLabel('Write a comment', { exact: true });
  await composer.fill('Could @');
  await expect(page.getByRole('listbox', { name: 'Mention a contributor' })).toBeVisible();
  await composer.press('ArrowDown');
  await composer.press('Enter');
  await expect(composer).toHaveValue('Could @davidmikan ');
  await expect(composer).toBeFocused();
  await expect(page.getByRole('listbox', { name: 'Mention a contributor' })).not.toBeVisible();
  expect(api.requests.filter(request => request.path.endsWith('/comments') && request.method === 'POST')).toHaveLength(0);
});

test('background polling keeps an unsent comment and shows genuine triage context', async ({ page }) => {
  const api = await installPlatformAPI(page);
  await page.clock.install();
  await page.goto('/#ticket/RLY-1');
  const composer = page.getByLabel('Write a comment', { exact: true });
  await composer.fill('My unsent reproduction notes.');
  await composer.evaluate(node => node.setSelectionRange(3, 9));
  api.detail.ticket.status = 'ready';
  api.detail.ticket.triage = { summary: 'The render loop replaces the composer node.', acceptanceCriteria: ['Preserve unsent input during background refresh.'], files: [{ path: 'demo/src/platform.js', reason: 'Ticket rendering and background polling live here.' }], documentation: [{ path: 'docs/ARCHITECTURE.md', reason: 'Describes the rendering and persistence boundaries.' }], ready: true };
  api.detail.jobs.push({ id: 'job-triage', ticketId: 'RLY-1', kind: 'triage', status: 'succeeded', runId: 123, runUrl: 'https://github.com/Huti-K/agentic-cicd-template/actions/runs/123', summary: 'Prepared an implementation plan.', headSha: HEAD_SHA, createdAt: '2026-10-12T10:00:00Z', updatedAt: '2026-10-12T10:01:00Z' });
  await page.clock.fastForward(9_000);
  await expect(page.getByText('The render loop replaces the composer node.', { exact: true })).toBeVisible();
  await expect(page.getByText('demo/src/platform.js', { exact: true })).toBeVisible();
  await expect(page.getByText('docs/ARCHITECTURE.md', { exact: true })).toBeVisible();
  await expect(composer).toHaveValue('My unsent reproduction notes.');
  await expect(composer).toBeFocused();
  expect(await composer.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([3, 9]);
  await page.getByRole('button', { name: 'Start implementation', exact: true }).click();
  await expect.poll(() => api.detail.ticket.status).toBe('implementing');
  expect(api.requests.find(request => request.path.endsWith('/actions')).body).toMatchObject({ action: 'implement' });
});

for (const priorPR of [false, true]) {
  test(`triage references stay pinned to the analyzed ${priorPR ? 'PR head' : 'base revision'} after later changes`, async ({ page }) => {
    const api = await installPlatformAPI(page);
    const baseSha = 'b'.repeat(40), analyzedHead = 'c'.repeat(40), laterHead = 'd'.repeat(40);
    api.detail.ticket.headSha = laterHead;
    api.detail.ticket.triage = {
      summary: 'The brief references the source inspected during triage.', ready: true,
      acceptanceCriteria: ['Keep source references pinned to the analyzed revision.'],
      files: [{ path: 'demo/src/platform.js', reason: 'The relevant browser source.' }],
      documentation: [{ path: 'docs/ARCHITECTURE.md', reason: 'The corresponding architecture.' }],
    };
    // A newer failed run must not change the references from the successful brief.
    api.detail.jobs = [
      { id: 'older', kind: 'triage', status: 'succeeded', baseSha: HEAD_SHA, headSha: null, createdAt: '2026-10-12T09:00:00Z' },
      { id: 'failed', kind: 'triage', status: 'failed', baseSha: laterHead, headSha: laterHead, createdAt: '2026-10-12T11:00:00Z' },
      { id: 'analyzed', kind: 'triage', status: 'succeeded', baseSha, headSha: priorPR ? analyzedHead : null, createdAt: '2026-10-12T10:00:00Z' },
    ];
    await page.goto('/#ticket/RLY-1');
    const revision = priorPR ? analyzedHead : baseSha;
    await expect(page.getByRole('link', { name: 'demo/src/platform.js', exact: true })).toHaveAttribute('href', `https://github.com/Huti-K/agentic-cicd-template/blob/${revision}/demo/src/platform.js`);
    await expect(page.getByRole('link', { name: 'docs/ARCHITECTURE.md', exact: true })).toHaveAttribute('href', `https://github.com/Huti-K/agentic-cicd-template/blob/${revision}/docs/ARCHITECTURE.md`);
  });
}

test('feedback launches revision work, while human editing pauses automatic reruns', async ({ page }) => {
  const api = await installPlatformAPI(page, { detail: reviewDetailFixture() });
  await page.goto('/#ticket/RLY-1');
  await page.getByLabel('Comment type', { exact: true }).selectOption('feedback');
  await page.getByLabel('Write a comment', { exact: true }).fill('Please keep the keyboard focus after polling.');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  expect(api.detail.jobs[0]).toMatchObject({ kind: 'implement', status: 'queued' });
  await page.getByRole('button', { name: 'Switch to human editing', exact: true }).click();
  await expect.poll(() => api.detail.ticket.status).toBe('human_edit');
  const jobsBefore = api.detail.jobs.length;
  await page.getByLabel('Comment type', { exact: true }).selectOption('feedback');
  await page.getByLabel('Write a comment', { exact: true }).fill('I will adjust the keyboard behavior myself.');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByText('I will adjust the keyboard behavior myself.', { exact: true })).toBeVisible();
  expect(api.detail.jobs).toHaveLength(jobsBefore);
  await page.getByRole('button', { name: 'Resume agents', exact: true }).click();
  await expect.poll(() => api.detail.ticket.status).toBe('in_review');
});

test('review exposes files and video evidence and confirms an exact PR revision before merging', async ({ page }) => {
  const api = await installPlatformAPI(page, { detail: reviewDetailFixture() });
  api.detail.pullRequest.freshness={fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30000).toISOString(),cached:true};
  await page.goto('/#ticket/RLY-1');
  await expect(page.getByText(/GitHub checked.*30 seconds.*rechecked live/)).toBeVisible();
  await page.getByText('1 changed files', { exact: true }).click();
  await expect(page.getByText('demo/src/platform.js', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Mobile reply flow video/ })).toHaveAttribute('href', /\/actions\/runs\/456\/artifacts\/789$/);
  await page.getByRole('button', { name: 'Approve and merge', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Approve and merge', exact: true });
  await expect(confirm).toContainText(HEAD_SHA.slice(0, 7));
  expect(api.requests.filter(request => request.body?.action === 'approve-merge')).toHaveLength(0);
  await confirm.getByRole('button', { name: 'Merge this revision', exact: true }).click();
  await expect(confirm).not.toBeVisible();
  expect(api.requests.find(request => request.body?.action === 'approve-merge').body).toEqual({ action: 'approve-merge', headSha: HEAD_SHA });
  expect(api.detail.ticket.status).toBe('merged');
});

test('stale PR revisions and missing evidence prevent a false successful merge', async ({ page }) => {
  const api = await installPlatformAPI(page, { detail: reviewDetailFixture() });
  await page.goto('/#ticket/RLY-1');
  await page.getByRole('button', { name: 'Approve and merge', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Approve and merge', exact: true });
  api.detail.pullRequest.headSha = 'b'.repeat(40);
  await confirm.getByRole('button', { name: 'Merge this revision', exact: true }).click();
  await expect(page.getByText(/The pull request changed\. Review its current revision before merging\./).first()).toBeVisible();
  expect(api.detail.ticket.status).toBe('in_review');
  api.detail.pullRequest.canMerge = false;
  api.detail.pullRequest.evidenceReady = false;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Approve and merge', exact: true })).toBeDisabled();
});

test('untrusted ticket content is text and unsafe evidence links never execute', async ({ page }) => {
  const unsafe = '<img src=x onerror="window.xssExecuted=true">';
  const detail = reviewDetailFixture();
  detail.ticket.title = unsafe;
  detail.ticket.description = '<script>window.xssExecuted=true</script>';
  detail.comments[0].body = unsafe;
  detail.evidence[0].url = 'javascript:window.xssExecuted=true';
  detail.pullRequest.url = 'javascript:window.xssExecuted=true';
  detail.ticket.issueUrl = 'javascript:window.xssExecuted=true';
  await installPlatformAPI(page, { detail });
  await page.goto('/#ticket/RLY-1');
  await expect(page.getByRole('heading', { name: unsafe, exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.xssExecuted)).toBeUndefined();
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
});

test('failed comment posts retain the draft and failed refresh keeps the ticket visible', async ({ page }) => {
  const api = await installPlatformAPI(page);
  await page.clock.install();
  await page.goto('/#ticket/RLY-1');
  const composer = page.getByLabel('Write a comment', { exact: true });
  await composer.fill('This reply should survive a connection failure.');
  api.failure = { method: 'POST', path: '/api/tickets/RLY-1/comments', error: 'The discussion could not be saved.' };
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByText('The discussion could not be saved.', { exact: true }).first()).toBeVisible();
  await expect(composer).toHaveValue('This reply should survive a connection failure.');
  api.failure = { method: 'GET', path: '/api/tickets/RLY-1', error: 'Ticket refresh is temporarily unavailable.' };
  await page.clock.fastForward(9_000);
  await expect(page.getByText(/Live updates paused: Ticket refresh is temporarily unavailable\./)).toBeVisible();
  await expect(page.getByRole('heading', { name: api.detail.ticket.title, exact: true })).toBeVisible();
  await expect(composer).toHaveValue('This reply should survive a connection failure.');
});

test('feedback rejected during a pending merge preserves its draft and selected type without claiming success', async ({ page }) => {
  const api=await installPlatformAPI(page,{detail:reviewDetailFixture()});
  api.detail.ticket.mergePending=true;api.detail.pullRequest.canMerge=false;
  api.failure={path:'/api/tickets/RLY-1/comments',method:'POST',status:409,code:'merge_pending',error:'A merge is in progress. Wait before requesting agent work.'};
  await page.goto('/#ticket/RLY-1');
  const composer=page.getByLabel('Write a comment',{exact:true}),kind=page.getByLabel('Comment type',{exact:true});
  await composer.fill('Please also preserve the attachment after refresh.');
  await kind.selectOption('feedback');
  await page.getByRole('button',{name:'Post comment',exact:true}).click();
  await expect(page.locator('#comment-composer').getByRole('alert')).toContainText('A merge is in progress.');
  await expect(composer).toHaveValue('Please also preserve the attachment after refresh.');
  await expect(kind).toHaveValue('feedback');
  await expect(page.getByText('Comment posted.',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Post comment',exact:true})).toBeEnabled();
  expect(api.requests.find(request=>request.method==='POST').body.kind).toBe('feedback');
  expect(api.detail.comments).toHaveLength(1);expect(api.detail.jobs).toHaveLength(1);
});

test('a simulated support email creates a ticket and starts triage with an idempotency key', async ({ page }) => {
  const api = await installPlatformAPI(page);
  await page.goto('/inbox.html');
  await page.getByRole('button', { name: 'Simulate incoming email', exact: true }).click();
  await page.getByLabel('Sender name', { exact: true }).fill('Jamie Example');
  await page.getByLabel('Sender email', { exact: true }).fill('jamie@example.test');
  await page.getByLabel('Subject', { exact: true }).fill('I cannot save a support reply');
  await page.getByLabel('Email body', { exact: true }).fill('On mobile, refreshing the ticket removed my reply.');
  api.failure = { method: 'POST', path: '/api/inbox', error: 'Mailbox temporarily unavailable.' };
  await page.getByRole('button', { name: 'Receive email and triage', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Mailbox temporarily unavailable.');
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('I cannot save a support reply');
  api.failure = null;
  api.incompleteEmail = true;
  await page.getByRole('button', { name: 'Receive email and triage', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Email saved; GitHub dispatch failed. Retry delivery with the same key.');
  await expect(page.getByLabel('Email body', { exact: true })).toHaveValue('On mobile, refreshing the ticket removed my reply.');
  expect(api.messages).toHaveLength(1);
  expect(api.detail.jobs).toHaveLength(0);
  const savedTicket = api.detail.ticket.id;
  api.incompleteEmail = false;
  await page.getByRole('button', { name: 'Receive email and triage', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect.poll(() => api.messages.length).toBe(1);
  const request = api.requests.find(request => request.method === 'POST' && request.path === '/api/inbox');
  expect(request.body).toMatchObject({ senderName: 'Jamie Example', senderEmail: 'jamie@example.test', subject: 'I cannot save a support reply' });
  expect(request.body.idempotencyKey).toEqual(expect.any(String));
  expect(request.body.idempotencyKey.length).toBeGreaterThan(15);
  expect(request.headers['x-csrf-token']).toBe(api.csrfToken);
  const deliveries = api.requests.filter(request => request.method === 'POST' && request.path === '/api/inbox');
  expect(deliveries).toHaveLength(3);
  expect(new Set(deliveries.map(delivery => delivery.body.idempotencyKey)).size).toBe(1);
  expect(api.detail.ticket.id).toBe(savedTicket);
  expect(api.detail.jobs).toHaveLength(1);
  expect(api.detail.jobs[0]).toMatchObject({ kind: 'triage', status: 'queued' });
  await page.reload();
  await expect(page.getByText('I cannot save a support reply', { exact: true }).first()).toBeVisible();
});

test('public inbox cannot create emails or start agents', async ({ page }) => {
  const api = await installPlatformAPI(page, { authenticated: false });
  await page.goto('/inbox.html');
  await page.getByRole('button', { name: 'Simulate incoming email', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Maintainer sign-in' })).toBeVisible();
  expect(api.requests.filter(request => request.method !== 'GET')).toHaveLength(0);
});

test('startup API failures are explicit and retry restores the live workspace without fictional fallback', async ({ page }) => {
  const api = await installPlatformAPI(page);
  api.failure = { path: '/api/workspace', method: 'GET', error: 'The platform is temporarily unavailable.' };
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The workspace is temporarily unavailable', exact: true })).toBeVisible();
  await expect(page.getByText(/No sample data has been substituted/)).toBeVisible();
  await expect(page.getByRole('button', { name: api.detail.ticket.title, exact: true })).toHaveCount(0);
  api.failure = null;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good work starts with a conversation.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: api.detail.ticket.title, exact: true })).toBeVisible();
});
