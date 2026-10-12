import { test, expect } from '@playwright/test';
import { installPlatformAPI, ticketFixture } from '../helpers/platform-api.js';

// Fixture-backed presentation and interaction checks, without live API writes.
const BLUE = 'rgb(29, 78, 216)';
const HOVER = 'rgb(30, 64, 175)';
const FOCUS = 'rgb(37, 99, 235)';
const SOFT = 'rgb(219, 234, 254)';
const SURFACE = 'rgb(239, 246, 255)';
const color = (locator, property) => locator.evaluate((node, property) => getComputedStyle(node)[property], property);

async function usable(page, locator) {
  await expect(locator).toBeVisible();
  // aria-expanded changes before the mobile sidebar's 200 ms transform ends.
  // Read fresh geometry on every attempt, preserving all viewport bounds.
  await expect(async () => {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }).toPass({ timeout: 3000 });
}

async function navigation(page, name) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
  }
  const link = page.locator('#sidebar').getByRole('link', { name: name === 'Tickets' ? /^Tickets(?:\s*\d+)?$/ : name, exact: true });
  await usable(page, link);
  await expect(page.locator('.nav-item.active')).toHaveCSS('background-color', SOFT);
  await link.click();
  if (await menu.isVisible()) await expect(menu).toHaveAttribute('aria-expanded', 'false');
}

function contrast(foreground, background) {
  const luminance = value => {
    const channels = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function readable(locator) {
  for (const node of await locator.all()) {
    if (!await node.isVisible()) continue;
    const styles = await node.evaluate(node => {
      const style = getComputedStyle(node);
      let backgrounds = ['rgb(255, 255, 255)'];
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
        const s = getComputedStyle(ancestor);
        if (s.backgroundImage.startsWith('linear-gradient')) {
          backgrounds = s.backgroundImage.match(/rgb\([^)]+\)/g);
          break;
        }
        if (s.backgroundColor.startsWith('rgb(')) { backgrounds = [s.backgroundColor]; break; }
      }
      return { foreground: style.color, backgrounds, size: parseFloat(style.fontSize), weight: Number(style.fontWeight) };
    });
    const minimum = styles.size >= 24 || (styles.size >= 18.66 && styles.weight >= 700) ? 3 : 4.5;
    for (const background of styles.backgrounds) {
      expect(contrast(styles.foreground, background), await node.textContent()).toBeGreaterThanOrEqual(minimum);
    }
  }
}

async function primaryStates(page, button) {
  await usable(page, button);
  // Move away first so desktop auto-hover cannot affect the base assertion.
  await page.mouse.move(0, 0);
  await expect(button).toHaveCSS('background-color', BLUE);
  await expect(button).toHaveCSS('color', 'rgb(255, 255, 255)');
  await button.hover();
  await expect(button).toHaveCSS('background-color', HOVER);
  expect(contrast('rgb(255, 255, 255)', HOVER)).toBeGreaterThanOrEqual(4.5);
  await page.mouse.move(0, 0);
  await page.keyboard.press('Tab');
  await button.focus();
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS('outline-color', FOCUS);
  await expect(button).toHaveCSS('outline-width', '3px');
  expect(contrast(FOCUS, SURFACE)).toBeGreaterThanOrEqual(3);
  await readable(button);
}

test('fixture-backed public workspace stays blue on reload and preserves navigation and sign-in gates', async ({ page }) => {
  const api = await installPlatformAPI(page, { authenticated: false });
  await page.goto('/index.html');
  const primary = page.getByRole('button', { name: 'New ticket', exact: true });
  await primaryStates(page, primary);
  await expect(page.locator('.inbox-callout')).toHaveCSS('background-image', 'linear-gradient(115deg, rgb(219, 234, 254), rgb(239, 246, 255))');
  await readable(page.locator('.page-heading h1, .page-description, .stat-label, .stat-card small, .workflow-explainer p, .inbox-callout h2, .inbox-callout p, .app-footer'));
  await primary.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Maintainer sign-in' });
  await usable(page, dialog);
  await expect(page.getByLabel('Password', { exact: true })).toHaveCSS('border-color', FOCUS);
  await readable(dialog.locator('h2, p, label, button'));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await navigation(page, 'Tickets');
  await expect(page).toHaveURL(/#tickets$/);
  const search = page.getByRole('searchbox', { name: 'Search tickets' });
  await usable(page, search);
  await search.focus();
  await expect(page.locator('.search-field')).toHaveCSS('border-color', FOCUS);
  expect(contrast(await color(page.locator('.search-field'), 'borderColor'), 'rgb(255, 255, 255)')).toBeGreaterThanOrEqual(3);
  await expect(page.locator('.list-heading')).toHaveCSS('background-color', SURFACE);
  await readable(page.locator('.ticket-title-link, .ticket-id, .list-heading, .page-description'));
  await page.getByRole('button', { name: api.detail.ticket.title, exact: true }).click();
  await expect(page.locator('.ticket-breadcrumb')).toContainText('RLY-1');
  await expect(page.getByRole('link', { name: 'GitHub issue #31', exact: true })).toHaveAttribute('href', api.detail.ticket.issueUrl);
  await expect(page.locator('.signin-prompt')).toHaveCSS('background-color', SURFACE);
  await expect(page.getByRole('button', { name: 'Post comment', exact: true })).toHaveCount(0);
  await readable(page.locator('.prose, .comment-body, .property-list dd, .contributor strong, .signin-prompt p'));
  await page.reload();
  await expect(page.locator('.signin-prompt')).toHaveCSS('background-color', SURFACE);
  await navigation(page, 'Overview');
  await expect(primary).toHaveCSS('background-color', BLUE);
  expect(api.requests.filter(request => request.method !== 'GET')).toEqual([]);
});

test('fixture-backed ticket dialog and composer use blue focus while statuses and identities stay distinct', async ({ page }) => {
  const api = await installPlatformAPI(page, {
    tickets: ['ready', 'queued', 'in_review', 'failed'].map((status, index) => ticketFixture({ id: `RLY-${index + 2}`, title: `${status} ticket`, status })),
  });
  api.detail.ticket.contributorIds = ['huti', 'davidmikan', 'ai'];
  await page.goto('/#tickets');
  const statuses = { ready: 'rgb(234, 246, 239)', queued: 'rgb(253, 245, 231)', in_review: 'rgb(240, 237, 251)', failed: 'rgb(253, 240, 237)' };
  for (const [status, background] of Object.entries(statuses)) {
    const badge = page.locator(`.ticket-list .badge.${status}`);
    await expect(badge).toHaveCSS('background-color', background);
    await readable(badge);
  }
  const identities = {
    agent: ['rgb(214, 239, 228)', 'rgb(53, 118, 94)'],
    blue: ['rgb(226, 234, 249)', 'rgb(82, 117, 170)'],
    violet: ['rgb(234, 232, 244)', 'rgb(102, 85, 154)'],
  };
  for (const [identity, [background, foreground]] of Object.entries(identities)) {
    const avatar = page.locator(`.ticket-list .avatar.${identity}`).first();
    await expect(avatar).toHaveCSS('background-color', background);
    await expect(avatar).toHaveCSS('color', foreground);
  }
  await page.getByRole('button', { name: api.detail.ticket.title, exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'Write a comment', exact: true });
  await draft.fill('Unsent feedback stays local.');
  await expect(draft).toHaveCSS('border-color', FOCUS);
  await expect(draft).toHaveCSS('background-color', SURFACE);
  await page.getByRole('button', { name: 'Edit ticket', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit ticket', exact: true });
  await usable(page, dialog);
  const title = dialog.locator('input[name="title"]');
  await title.focus();
  await expect(title).toHaveCSS('border-color', FOCUS);
  await expect.poll(() => color(title, 'boxShadow')).toContain(FOCUS);
  expect(contrast(await color(title, 'borderColor'), 'rgb(255, 255, 255)')).toBeGreaterThanOrEqual(3);
  await usable(page, title);
  await primaryStates(page, dialog.getByRole('button', { name: 'Save changes', exact: true }));
  await readable(dialog.locator('h2, label, legend, .contributor-option, input:not([type="checkbox"]), textarea'));
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(draft).toHaveValue('Unsent feedback stays local.');
  expect(api.requests.filter(request => request.method !== 'GET')).toEqual([]);
});

for (const authenticated of [false, true]) test(`fixture-backed ${authenticated ? 'maintainer' : 'public'} inbox uses blue selections and usable dialogs without theme writes`, async ({ page }) => {
  const messages = [1, 2].map(index => ({ id: `email-${index}`, ticketId: 'RLY-1', senderName: 'Jamie Parker', senderEmail: 'jamie@example.test', subject: `Customer request ${index}`, body: 'Please keep <img src=x onerror=alert(1)> as customer text.', createdAt: '2026-10-12T10:00:00Z' }));
  const api = await installPlatformAPI(page, { authenticated, messages });
  await page.goto('/inbox.html');
  const primary = page.getByRole('button', { name: 'Simulate incoming email', exact: true });
  await primaryStates(page, primary);
  await expect(page.locator('.inbox-demo-note')).toHaveCSS('background-color', SURFACE);
  const message = page.getByRole('button', { name: messages[1].subject, exact: true });
  await usable(page, message);
  await message.click();
  await expect(message).toHaveClass(/selected/);
  await expect(message).toHaveCSS('background-color', SURFACE);
  await expect.poll(() => color(message, 'boxShadow')).toContain(BLUE);
  await expect(page.getByRole('button', { name: messages[0].subject, exact: true })).not.toHaveClass(/selected/);
  await expect(page.locator('.mail-body')).toHaveText(messages[1].body);
  await expect(page.locator('.mail-body img')).toHaveCount(0);
  await expect(page.locator('.mail-ticket-card')).toHaveCSS('background-color', SURFACE);
  await readable(page.locator('.mail-subject, .mail-item p, .mail-item-top strong, .mail-item-top time, .mail-ticket, .mail-reading-header h2, .mail-sender strong, .mail-sender small, .mail-body, .mail-ticket-card p, .inbox-demo-note'));
  await primary.click();
  const dialog = page.getByRole('dialog');
  await usable(page, dialog);
  const input = authenticated ? dialog.locator('input[name="subject"]') : page.getByLabel('Password', { exact: true });
  await input.focus();
  await expect(input).toHaveCSS('border-color', FOCUS);
  await usable(page, input);
  await primaryStates(page, dialog.locator('.button.primary'));
  await readable(dialog.locator('h2, p, label, button'));
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await expect(primary).toHaveCSS('background-color', BLUE);
  await expect(page.locator('.mail-item.selected')).toHaveCSS('background-color', SURFACE);
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  await usable(page, page.locator('.nav-item.active'));
  await expect(page.locator('.nav-item.active')).toHaveCSS('background-color', SOFT);
  if (await menu.isVisible()) {
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeHidden();
  }
  const openTicket = page.getByRole('link', { name: 'Open ticket', exact: true });
  await usable(page, openTicket);
  await openTicket.click();
  await expect(page).toHaveURL(/#ticket\/RLY-1$/);
  await expect(page.locator('.ticket-breadcrumb')).toContainText('RLY-1');
  expect(api.requests.filter(request => request.method !== 'GET')).toEqual([]);
});
