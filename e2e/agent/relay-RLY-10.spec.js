import { test, expect } from '@playwright/test';
import { installPlatformAPI } from '../helpers/platform-api.js';

// RLY-10: fixture-backed sidebar checks; no live services or mutations.
const WHITE = 'rgb(255, 255, 255)';
const TEXT = 'rgb(36, 59, 83)';
const MUTED = 'rgb(71, 85, 105)';
const GREEN = 'rgb(22, 101, 52)';
const SOFT = 'rgb(220, 252, 231)';
const FOCUS = 'rgb(21, 128, 61)';

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

async function openNavigation(page) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible() && await menu.getAttribute('aria-expanded') === 'false') {
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
  }
  const sidebar = page.locator('#sidebar');
  await expect(sidebar).toBeVisible();
  await expect(async () => {
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }).toPass({ timeout: 3000 });
  return sidebar;
}

async function collapsed(page) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) {
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeHidden();
  }
}

async function lightSidebar(page, activeHref, authenticated = false) {
  const sidebar = await openNavigation(page);
  await expect(sidebar).toHaveCSS('background-color', WHITE);
  await expect(sidebar.locator('.brand')).toHaveCSS('color', TEXT);
  await expect(sidebar.locator('.side-user strong')).toHaveText(authenticated ? 'Huti' : 'Public access');
  await expect(sidebar.locator('.side-user small')).toHaveText(authenticated ? 'Maintainer' : 'Read only');
  await expect(sidebar.locator('.side-user strong')).toHaveCSS('color', TEXT);
  await expect(sidebar.locator('.side-user small')).toHaveCSS('color', MUTED);
  const active = sidebar.locator(`a[href="${activeHref}"]`);
  await expect(active).toHaveAttribute('aria-current', 'page');
  await expect(active).toHaveCSS('background-color', SOFT);
  await expect(active).toHaveCSS('color', GREEN);
  await expect(active.locator('svg')).toHaveCSS('color', GREEN);
  await expect(active).toHaveCSS('border-left-color', GREEN);
  // Check only the changed sidebar text, using each label's actual solid background.
  await expect(async () => {
    const labels = await sidebar.locator('.brand, .nav-item, .nav-count, .side-user strong, .side-user small').evaluateAll(nodes => nodes.map(node => {
      let ancestor = node;
      while (ancestor && !getComputedStyle(ancestor).backgroundColor.startsWith('rgb(')) ancestor = ancestor.parentElement;
      return { text: node.textContent, foreground: getComputedStyle(node).color, background: getComputedStyle(ancestor).backgroundColor };
    }));
    for (const label of labels) expect(contrast(label.foreground, label.background), label.text).toBeGreaterThanOrEqual(4.5);
  }).toPass({ timeout: 3000 });
  return sidebar;
}

async function noWrites(page, api) {
  expect(api.requests.filter(request => request.method !== 'GET')).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
}

test('fixture-backed light sidebar persists across public workspace routes and inbox reload @mobile', async ({ page }) => {
  const api = await installPlatformAPI(page, { authenticated: false });
  await page.goto('/index.html');
  let sidebar = await lightSidebar(page, '#overview');
  await expect(sidebar.locator('a[href="#tickets"]')).toHaveAccessibleName(/^Tickets\s*1$/);
  for (const [name, href] of [['Pipeline dashboard', './pipeline.html'], ['Local playground', './showcase.html']]) {
    await expect(sidebar.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  }
  await sidebar.locator('a[href="#tickets"]').click();
  await collapsed(page);
  await expect(page).toHaveURL(/#tickets$/);
  sidebar = await lightSidebar(page, '#tickets');
  // Close the mobile drawer before interacting with content beneath it.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: api.detail.ticket.title, exact: true }).click();
  await expect(page).toHaveURL(/#ticket\/RLY-1$/);
  await lightSidebar(page, '#tickets');
  await page.reload();
  sidebar = await lightSidebar(page, '#tickets');
  await sidebar.locator('a[href="#overview"]').click();
  await collapsed(page);
  await expect(page).toHaveURL(/#overview$/);
  sidebar = await lightSidebar(page, '#overview');
  await sidebar.getByRole('link', { name: 'Support inbox', exact: true }).click();
  await expect(page).toHaveURL(/\/inbox.html$/);
  await collapsed(page);
  await lightSidebar(page, './inbox.html');
  await page.reload();
  await lightSidebar(page, './inbox.html');
  await page.keyboard.press('Escape');
  await page.locator('#session-actions').getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Maintainer sign-in', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await noWrites(page, api);
});

test('fixture-backed maintainer sidebar keeps light hover, keyboard focus and drawer dismissal @mobile', async ({ page }) => {
  const api = await installPlatformAPI(page);
  await page.goto('/inbox.html');
  const sidebar = await lightSidebar(page, './inbox.html', true);
  const inactive = sidebar.getByRole('link', { name: 'Overview', exact: true });
  await expect(inactive).not.toHaveAttribute('aria-current', 'page');
  await expect(inactive).toHaveCSS('color', MUTED);
  await expect(inactive.locator('svg')).toHaveCSS('color', MUTED);
  await inactive.hover();
  await expect(inactive).toHaveCSS('background-color', 'rgb(248, 250, 252)');
  await expect(inactive).toHaveCSS('color', TEXT);
  await expect(inactive.locator('svg')).toHaveCSS('color', TEXT);
  expect(contrast(TEXT, 'rgb(248, 250, 252)')).toBeGreaterThanOrEqual(4.5);
  await page.mouse.move(page.viewportSize().width - 1, 0);
  await expect(inactive).toHaveCSS('color', MUTED);
  await page.keyboard.press('Tab');
  for (const link of [inactive, sidebar.locator('a[href="./inbox.html"]')]) {
    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toHaveCSS('outline-style', 'solid');
    await expect(link).toHaveCSS('outline-color', FOCUS);
    await expect(link).toHaveCSS('outline-width', '3px');
    expect(contrast(FOCUS, WHITE)).toBeGreaterThanOrEqual(3);
    expect(contrast(FOCUS, SOFT)).toBeGreaterThanOrEqual(3);
  }
  if (await page.getByRole('button', { name: 'Open navigation', exact: true }).isVisible()) {
    await page.keyboard.press('Escape');
    await collapsed(page);
    await lightSidebar(page, './inbox.html', true);
    // Use the uncovered right edge of the backdrop, outside the drawer.
    await page.getByRole('button', { name: 'Close navigation', exact: true }).click({ position: { x: page.viewportSize().width - 8, y: 80 } });
    await collapsed(page);
    await lightSidebar(page, './inbox.html', true);
  }
  await inactive.press('Enter');
  await expect(page).toHaveURL(/#overview$/);
  await collapsed(page);
  await lightSidebar(page, '#overview', true);
  await page.reload();
  await lightSidebar(page, '#overview', true);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await noWrites(page, api);
});
