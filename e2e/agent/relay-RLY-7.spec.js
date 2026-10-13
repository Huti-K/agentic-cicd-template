import { test, expect } from '@playwright/test';
import { installPlatformAPI, detailFixture, ticketFixture } from '../helpers/platform-api.js';

// RLY-7 evidence uses fixture-backed API responses, with no live service writes.
const GREEN = 'rgb(22, 101, 52)';
const FOCUS = 'rgb(21, 128, 61)';
const SOFT = 'rgb(220, 252, 231)';
const SURFACE = 'rgb(240, 253, 244)';
const BORDER = 'rgb(134, 239, 172)';

async function navigate(page, destination) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  const link = page.locator(`#sidebar a[href="#${destination}"]`);
  await expect(link).toBeVisible();
  await expect(async () => {
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }).toPass({ timeout: 3000 });
  await expect(page.locator('.nav-item.active')).toHaveCSS('background-color', SOFT);
  await expect(page.locator('.nav-item.active')).toHaveCSS('border-left-color', GREEN);
  await link.click();
  if (await menu.isVisible()) {
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeHidden();
  }
}

async function unchangedState(page, api) {
  expect(api.requests.filter(request => request.method !== 'GET')).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
}

test('fixture-backed green workspace keeps ticket links and public access through navigation and reload', { tag: '@mobile' }, async ({ page }) => {
  const ticket = ticketFixture({ prNumber: 32, prUrl: 'https://github.com/Huti-K/agentic-cicd-template/pull/32' });
  const api = await installPlatformAPI(page, { authenticated: false, detail: detailFixture({ ticket }) });
  await page.goto('/index.html');
  const primary = page.getByRole('button', { name: 'New ticket', exact: true });
  await expect(primary).toHaveCSS('background-color', GREEN);
  await expect(page.locator('.inbox-callout')).toHaveCSS('background-image', `linear-gradient(115deg, ${SOFT}, ${SURFACE})`);
  await expect(page.locator('.inbox-callout')).toHaveCSS('border-color', BORDER);
  await primary.hover();
  await expect(primary).toHaveCSS('background-color', 'rgb(20, 83, 45)');
  await page.mouse.move(0, 0);
  await page.keyboard.press('Tab');
  await primary.focus();
  await expect(primary).toHaveCSS('outline-color', FOCUS);
  await expect(primary).toHaveCSS('outline-width', '3px');
  await primary.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Maintainer sign-in' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCSS('border-color', FOCUS);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await navigate(page, 'tickets');
  await expect(page.locator('.list-heading')).toHaveCSS('background-color', SURFACE);
  await page.getByRole('button', { name: ticket.title, exact: true }).click();
  await expect(page.locator('.ticket-breadcrumb')).toContainText(ticket.id);
  await expect(page.getByRole('link', { name: 'GitHub issue #31', exact: true })).toHaveAttribute('href', ticket.issueUrl);
  await expect(page.getByRole('link', { name: 'Open pull request #32', exact: true })).toHaveAttribute('href', ticket.prUrl);
  await expect(page.locator('.signin-prompt')).toHaveCSS('background-color', SURFACE);
  await expect(page.getByRole('button', { name: 'Post comment', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.signin-prompt')).toHaveCSS('background-color', SURFACE);
  await navigate(page, 'overview');
  await expect(primary).toHaveCSS('background-color', GREEN);
  await unchangedState(page, api);
});

test('fixture-backed empty inbox becomes a green keyboard selection without unsafe rendering or writes', { tag: '@mobile' }, async ({ page }) => {
  const api = await installPlatformAPI(page, { authenticated: false, messages: [] });
  await page.goto('/inbox.html');
  await expect(page.getByRole('heading', { name: 'Your inbox is ready', exact: true })).toBeVisible();
  await expect(page.locator('.mail-item.selected')).toHaveCount(0);
  await expect(page.locator('.mailbox .empty-icon')).toHaveCSS('background-color', SURFACE);
  const primary = page.getByRole('button', { name: 'Simulate incoming email', exact: true });
  await expect(primary).toHaveCSS('background-color', GREEN);
  await primary.click();
  const dialog = page.getByRole('dialog', { name: 'Maintainer sign-in' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.mail-item')).toHaveCount(0);

  api.messages = [1, 2].map(index => ({ id: `email-${index}`, ticketId: 'RLY-1', senderName: 'Jamie Parker', senderEmail: 'jamie@example.test', subject: `Customer request ${index}`, body: 'Render <img src=x onerror=alert(1)> as text.', createdAt: '2026-10-12T10:00:00Z' }));
  await page.reload();
  const message = page.getByRole('button', { name: api.messages[1].subject, exact: true });
  await page.keyboard.press('Tab');
  await message.focus();
  await expect(message).toHaveCSS('outline-color', FOCUS);
  await message.press('Enter');
  await expect(message).toHaveClass(/selected/);
  await expect(message).toHaveCSS('background-color', SURFACE);
  await expect.poll(() => message.evaluate(node => getComputedStyle(node).boxShadow)).toContain(GREEN);
  await expect(page.getByRole('button', { name: api.messages[0].subject, exact: true })).not.toHaveClass(/selected/);
  await expect(page.locator('.mail-body')).toHaveText(api.messages[1].body);
  await expect(page.locator('.mail-body img')).toHaveCount(0);
  await expect(page.locator('.mail-ticket-card')).toHaveCSS('background-color', SURFACE);
  await expect(page.getByRole('link', { name: 'Open ticket', exact: true })).toHaveAttribute('href', './#ticket/RLY-1');
  await unchangedState(page, api);
});
