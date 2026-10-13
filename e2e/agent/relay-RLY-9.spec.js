import { test, expect } from '@playwright/test';
import { installPlatformAPI, ticketFixture } from '../helpers/platform-api.js';

// RLY-9 acceptance evidence is fixture-backed; no live service writes.
test('fixture-backed Clear resets a zero-match queue and keeps the next search focused', { tag: '@mobile' }, async ({ page, isMobile }) => {
  const api=await installPlatformAPI(page, { authenticated: false });
  api.tickets=Array.from({length:74},(_,index)=>ticketFixture({
    id:`RLY-${index+2}`,title:`Archived request ${index+2}`,status:'deployed',priority:'low',
  }));
  const original=structuredClone([api.detail.ticket,...api.tickets]);
  await page.goto('/#tickets');
  const list=page.getByRole('region',{name:'Tickets',exact:true});
  const search=page.getByRole('searchbox',{name:'Search tickets',exact:true});
  const status=page.getByLabel('Filter by status',{exact:true});
  const priority=page.getByLabel('Filter by priority',{exact:true});
  const clear=page.getByRole('button',{name:'Clear',exact:true});
  await expect(list).toContainText('Showing 50 of 75 tickets');
  await expect(clear).toBeHidden();
  await priority.focus();await page.keyboard.press('Tab');
  await expect(page.locator('.filter-toolbar button')).not.toBeFocused();

  // Whitespace is an active control value even though matching trims it.
  await search.fill('   ');await expect(clear).toBeVisible();
  await search.fill('');await expect(clear).toBeHidden();
  await status.selectOption('new');await expect(clear).toBeVisible();
  await status.selectOption('');await expect(clear).toBeHidden();
  await priority.selectOption('high');await expect(clear).toBeVisible();
  await priority.selectOption('');await expect(clear).toBeHidden();

  await page.getByRole('button',{name:'Load more tickets',exact:true}).click();
  await expect(list).toContainText('Showing 75 of 75 tickets');
  // Keep the same input node and caret while visibility updates during typing.
  const originalSearch=await search.elementHandle();
  await search.fill('Archived');
  await search.press('ArrowLeft');
  await page.keyboard.type('x');
  await expect(search).toHaveValue('Archivexd');
  expect(await originalSearch.evaluate(node=>node===document.querySelector('#ticket-search'))).toBe(true);
  expect(await search.evaluate(node=>node.selectionStart)).toBe(8);
  await expect(search).toBeFocused();
  await status.selectOption('new');
  await priority.selectOption('high');
  await expect(list).toContainText('Showing 0 of 0 tickets');
  await expect(list.getByRole('heading',{name:'No matching tickets',exact:true})).toBeVisible();
  await expect(clear).toHaveText('Clear');

  // Keyboard activation restores the first page without its previous cursor.
  const resetRequest=page.waitForRequest(request=>{
    const url=new URL(request.url());
    return url.pathname==='/api/tickets'&&url.searchParams.get('query')===''
      &&url.searchParams.get('status')===''&&url.searchParams.get('priority')==='';
  });
  await clear.focus();await page.keyboard.press('Enter');
  await expect(search).toBeFocused();
  expect(new URL((await resetRequest).url()).searchParams.has('cursor')).toBe(false);
  await expect(search).toHaveValue('');await expect(status).toHaveValue('');await expect(priority).toHaveValue('');
  await expect(clear).toBeHidden();
  await expect(list).toContainText('Showing 50 of 75 tickets');
  await expect(list.locator('.ticket-line')).toHaveCount(50);
  await expect(list.locator('.ticket-id').first()).toHaveText('RLY-75');
  await expect(list.locator('.ticket-id').last()).toHaveText('RLY-26');
  await expect(search).toBeFocused();
  await page.keyboard.type('Preserve a reply');
  await expect(list).toContainText('Showing 1 of 1 ticket');
  await expect(list.getByRole('button',{name:api.detail.ticket.title,exact:true})).toBeVisible();
  await expect(search).toBeFocused();

  // The same control also works with pointer/touch on both browser projects.
  if(isMobile) await clear.tap(); else await clear.click();
  await expect(list).toContainText('Showing 50 of 75 tickets');
  await expect(search).toBeFocused();
  await page.getByRole('button',{name:'Load more tickets',exact:true}).click();
  await expect(list).toContainText('Showing 75 of 75 tickets');
  await expect(list.locator('.ticket-line')).toHaveCount(75);
  expect(api.requests.filter(request=>request.method!=='GET')).toEqual([]);
  expect([api.detail.ticket,...api.tickets]).toEqual(original);
  await list.getByRole('button',{name:api.detail.ticket.title,exact:true}).click();
  await expect(page.getByRole('link',{name:'GitHub issue #31',exact:true})).toHaveAttribute('href',api.detail.ticket.issueUrl);
  await expect(page.getByRole('button',{name:'Post comment',exact:true})).toHaveCount(0);
  expect(api.requests.filter(request=>request.method!=='GET')).toEqual([]);
});
