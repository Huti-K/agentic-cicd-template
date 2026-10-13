import { test, expect } from '@playwright/test';
import { installPlatformAPI } from '../helpers/platform-api.js';

// Fixture-backed RLY-5 navigation coverage with the RLY-7 green palette; no live services or mutations.
async function withinViewport(page, locator) {
  await expect(locator).toBeVisible();
  await expect(async () => {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }).toPass({ timeout: 3000 });
}

test('fixture-backed green flat navigation keeps destinations, access and mobile dismissal working', { tag: '@mobile' }, async ({ page }) => {
  const api = await installPlatformAPI(page, { authenticated: false });
  await page.goto('/index.html');
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  const overlay = page.getByRole('button', { name: 'Close navigation', exact: true });
  const mobile = await menu.isVisible();
  const openMenu = async () => {
    if (mobile) {
      await menu.click();
      await expect(menu).toHaveAttribute('aria-expanded', 'true');
      await expect(overlay).toBeVisible();
    }
    await withinViewport(page, page.locator('#sidebar'));
  };
  const collapsed = async () => {
    if (mobile) {
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await expect(overlay).toBeHidden();
    }
  };
  await withinViewport(page, page.getByRole('button', { name: 'New ticket', exact: true }));
  await expect(page.getByRole('button', { name: 'New ticket', exact: true })).toHaveCSS('background-color', 'rgb(22, 101, 52)');
  await withinViewport(page, page.locator('#session-actions').getByRole('button', { name: 'Sign in', exact: true }));
  await openMenu();
  const sidebar = page.locator('#sidebar');
  const destinations = [
    ['Overview', '#overview'], [/^Tickets\s*1$/, '#tickets'],
    ['Support inbox', './inbox.html'], ['Pipeline dashboard', './pipeline.html'],
    ['Local playground', './showcase.html'],
  ];
  for (const [name, href] of destinations) {
    const link = sidebar.getByRole('link', { name, exact: true });
    await withinViewport(page, link);
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveCSS('border-radius', '0px');
    await expect(link).toHaveCSS('box-shadow', 'none');
  }
  const active = sidebar.locator('.nav-item.active');
  await expect(active).toHaveAttribute('aria-current', 'page');
  await expect(active).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(active).toHaveCSS('border-left-color', 'rgb(22, 101, 52)');
  await expect(active).toHaveCSS('color', 'rgb(22, 101, 52)');
  await expect(active.locator('svg')).toHaveCSS('color', 'rgb(22, 101, 52)');
  // The dashboard shares the conventional four-panel Overview icon.
  const dashboardIcon = sidebar.getByRole('link', { name: 'Pipeline dashboard', exact: true }).locator('svg').first();
  await expect(dashboardIcon.locator('path')).toHaveAttribute('d', await sidebar.locator('a[href="#overview"] svg path').getAttribute('d'));
  await expect(sidebar).toContainText('Public access');
  await expect(sidebar).toContainText('Read only');

  if (mobile) {
    await page.keyboard.press('Escape');
    await collapsed();
    await openMenu();
    // Click the uncovered right edge, outside the sliding sidebar.
    await overlay.click({ position: { x: page.viewportSize().width - 8, y: 80 } });
    await collapsed();
    await openMenu();
  }
  await sidebar.locator('a[href="#tickets"]').click();
  await collapsed();
  await expect(page).toHaveURL(/#tickets$/);
  await expect(page.locator('#view-title')).toHaveText('Tickets');
  await page.getByRole('button', { name: api.detail.ticket.title, exact: true }).click();
  await expect(sidebar.locator('a[href="#tickets"]')).toHaveAttribute('aria-current', 'page');
  await openMenu();
  await sidebar.getByRole('link', { name: 'Support inbox', exact: true }).click();
  await expect(page).toHaveURL(/\/inbox.html$/);
  await collapsed();
  await expect(page.getByRole('button', { name: 'Simulate incoming email', exact: true })).toHaveCSS('background-color', 'rgb(22, 101, 52)');

  api.authenticated = true;
  await page.reload();
  await withinViewport(page, page.getByRole('button', { name: 'Sign out', exact: true }));
  await openMenu();
  await expect(sidebar.locator('.nav-item.active')).toHaveText('Support inbox');
  await expect(sidebar.locator('.nav-item.active')).toHaveAttribute('aria-current', 'page');
  await expect(sidebar).toContainText('Maintainer');
  expect(api.requests.filter(request => request.method !== 'GET')).toEqual([]);
});
