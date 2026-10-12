import { test, expect } from '@playwright/test';
import { installPlatformAPI, detailFixture, ticketFixture } from '../helpers/platform-api.js';

// Fixture-backed API and clipboard scenarios; these do not exercise live services
// or claim that the operating system clipboard was written.
async function installClipboard(page, mode = 'success') {
  await page.addInitScript(mode => {
    const state=window.ticketClipboardFixture={mode,writes:[],resolve:null};
    Object.defineProperty(navigator,'clipboard',{configurable:true,get:()=>{
      if(state.mode==='missing')return undefined;
      if(state.mode==='missing-write')return {};
      return {writeText(value){
        state.writes.push(value);
        if(state.mode==='reject')return Promise.reject(new Error('Permission denied'));
        if(state.mode==='pending')return new Promise(resolve=>{state.resolve=resolve;});
        return Promise.resolve();
      }};
    }});
  }, mode);
}
const copyButton=page=>page.getByRole('button',{name:'Copy ticket link',exact:true});
const copiedURL=page=>page.evaluate(()=>window.ticketClipboardFixture.writes.at(-1));

test('fixture-backed public copy works beside a long title and opens the same ticket', { tag: '@mobile' }, async ({page}) => {
  const api=await installPlatformAPI(page,{authenticated:false});
  api.detail.ticket.title='Long customer title '+ 'x'.repeat(180) + ' <img src=x onerror=alert(1)>';
  const original=structuredClone(api.detail),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await installClipboard(page);
  await page.goto('/index.html?old=filter#ticket/RLY-1');
  const row=page.locator('.ticket-title-row');
  await expect(row.getByRole('heading',{name:api.detail.ticket.title,exact:true})).toBeVisible();
  await expect(row.locator('img')).toHaveCount(0);
  await expect(copyButton(page)).toBeVisible();
  const bounds=await copyButton(page).boundingBox();
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
  await copyButton(page).click();
  const expected=new URL('/index.html#ticket/RLY-1',page.url()).href;
  expect(await copiedURL(page)).toBe(expected);
  const status=page.getByRole('status').filter({hasText:'Ticket link copied for RLY-1.'});
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('aria-live','polite');
  await expect(page).toHaveURL(/\?old=filter#ticket\/RLY-1$/);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('I can help reproduce this on mobile.',{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'GitHub issue #31',exact:true})).toHaveAttribute('href',original.ticket.issueUrl);
  expect(api.detail).toEqual(original);
  expect(api.requests.filter(request=>request.method!=='GET')).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.goto(expected);
  await expect(page.getByRole('heading',{name:original.ticket.title,exact:true})).toBeVisible();
  await expect(page.locator('.ticket-breadcrumb')).toContainText('RLY-1');
  expect(errors).toEqual([]);
});

test('fixture-backed keyboard copying waits for success and preserves the discussion draft and actions', async ({page}) => {
  const api=await installPlatformAPI(page),original=structuredClone(api.detail);
  await installClipboard(page,'pending');
  await page.goto('/#ticket/RLY-1');
  const draft=page.getByLabel('Write a comment',{exact:true});
  await draft.fill('An unsent reply with @ai that must stay unsent.');
  await draft.evaluate(node=>node.setSelectionRange(3,10));
  await copyButton(page).focus();
  await expect(copyButton(page)).toBeFocused();
  await copyButton(page).press('Enter');
  await expect(page.locator('#toast')).toHaveText('Copying ticket link for RLY-1…');
  expect(await copiedURL(page)).toBe(new URL('/#ticket/RLY-1',page.url()).href);
  await page.evaluate(()=>window.ticketClipboardFixture.resolve());
  await expect(page.locator('#toast')).toHaveText('Ticket link copied for RLY-1.');
  await expect(draft).toHaveValue('An unsent reply with @ai that must stay unsent.');
  expect(await draft.evaluate(node=>[node.selectionStart,node.selectionEnd])).toEqual([3,10]);
  await expect(page.getByRole('button',{name:'Post comment',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Edit ticket',exact:true})).toBeEnabled();
  await page.evaluate(()=>{window.ticketClipboardFixture.mode='success';});
  await copyButton(page).press('Space');
  await expect.poll(()=>page.evaluate(()=>window.ticketClipboardFixture.writes.length)).toBe(2);
  expect(api.detail).toEqual(original);
  expect(api.requests.filter(request=>request.method!=='GET')).toEqual([]);
  await expect(page).toHaveURL(/#ticket\/RLY-1$/);
});

for(const mode of ['missing','missing-write','reject'])test('fixture-backed '+mode+' clipboard feedback permits a later successful copy', async ({page}) => {
  const api=await installPlatformAPI(page,{authenticated:false}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await installClipboard(page,mode);
  await page.goto('/#ticket/RLY-1');
  await copyButton(page).click();
  const status=page.locator('#toast');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('role','status');
  await expect(status).toHaveAttribute('aria-live','polite');
  await expect(status).toHaveText('Automatic copying is unavailable or was denied. Copy the ticket URL from the address bar instead.');
  await expect(status).not.toContainText('copied');
  await page.evaluate(()=>{window.ticketClipboardFixture.mode='success';});
  await copyButton(page).click();
  await expect(status).toHaveText('Ticket link copied for RLY-1.');
  expect(await copiedURL(page)).toBe(new URL('/#ticket/RLY-1',page.url()).href);
  expect(api.requests.filter(request=>request.method!=='GET')).toEqual([]);
  expect(errors).toEqual([]);
});

test('fixture-backed pending copy keeps its ticket while navigation makes the next copy use the new ticket', async ({page}) => {
  const api=await installPlatformAPI(page,{authenticated:false});
  await installClipboard(page,'pending');
  await page.goto('/#ticket/RLY-1');
  await copyButton(page).click();
  await expect(page.locator('#toast')).toHaveText('Copying ticket link for RLY-1…');
  api.detail=detailFixture({ticket:ticketFixture({id:'RLY-2',title:'Another support request'}),comments:[]});
  await page.locator('.ticket-breadcrumb').getByRole('button',{name:'Tickets',exact:true}).click();
  await page.getByRole('button',{name:'Another support request',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Another support request',exact:true})).toBeVisible();
  expect(await copiedURL(page)).toBe(new URL('/#ticket/RLY-1',page.url()).href);
  await page.evaluate(()=>{window.ticketClipboardFixture.resolve();window.ticketClipboardFixture.mode='success';});
  await expect(page.locator('#toast')).toHaveText('Ticket link copied for RLY-1.');
  await copyButton(page).click();
  await expect(page.locator('#toast')).toHaveText('Ticket link copied for RLY-2.');
  expect(await page.evaluate(()=>window.ticketClipboardFixture.writes)).toEqual([
    new URL('/#ticket/RLY-1',page.url()).href,new URL('/#ticket/RLY-2',page.url()).href,
  ]);
  await expect(page).toHaveURL(/#ticket\/RLY-2$/);
  expect(api.requests.filter(request=>request.method!=='GET')).toEqual([]);
});
