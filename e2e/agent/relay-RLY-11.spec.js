import { test, expect } from '@playwright/test';
import { installPlatformAPI, ticketFixture } from '../helpers/platform-api.js';

// RLY-11 fixture-backed edge coverage complements RLY-10's route/role/drawer journeys.
test('fixture-backed black sidebar keeps multi-digit and zero counts readable without recoloring content @mobile', async ({ page }) => {
  const api = await installPlatformAPI(page, {
    authenticated: false,
    tickets: Array.from({ length: 9 }, (_, index) => ticketFixture({ id: `RLY-${index + 2}`, title: `Request ${index + 2}` })),
  });
  const sidebar = page.locator('#sidebar');
  const tickets = sidebar.locator('a[href="#tickets"]');
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  const open = async () => {
    if (await menu.isVisible()) await menu.click();
    await expect(sidebar).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await expect(async () => {
      const box = await sidebar.boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }).toPass({ timeout: 3000 });
  };
  const count = async value => {
    await expect(tickets).toHaveAccessibleName(new RegExp(`^Tickets\\s*${value}$`));
    await expect(tickets.locator('.nav-count')).toHaveText(String(value));
    await expect(tickets.locator('.nav-count')).toHaveCSS('background-color', 'rgb(240, 253, 244)');
    await expect(tickets.locator('.nav-count')).toHaveCSS('color', 'rgb(22, 101, 52)');
  };
  const noWrites = async () => {
    expect(api.requests.filter(request => request.method !== 'GET')).toEqual([]);
    expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  };

  await page.goto('/index.html');
  await expect(page.locator('.topbar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(248, 250, 252)');
  await expect(page.getByRole('button', { name: 'New ticket', exact: true })).toHaveCSS('background-color', 'rgb(22, 101, 52)');
  await expect(page.locator('.page-heading h1')).toHaveCSS('color', 'rgb(36, 59, 83)');
  await open();
  await count(10);
  await expect(tickets).not.toHaveAttribute('aria-current', 'page');
  await tickets.hover();
  await count(10);
  await tickets.click();
  await expect(page).toHaveURL(/#tickets$/);
  await noWrites();
  await page.reload();
  await open();
  await expect(tickets).toHaveAttribute('aria-current', 'page');
  await count(10);
  await noWrites();

  // A legitimate zero open count must remain visible, with the same destination and colors.
  api.detail.ticket.status = 'deployed';
  api.tickets.forEach(ticket => { ticket.status = 'deployed'; });
  await page.reload();
  await open();
  await count(0);
  await expect(tickets).toHaveAttribute('href', '#tickets');
  await expect(tickets).toHaveAttribute('aria-current', 'page');
  await expect(sidebar.locator('.side-user strong')).toHaveText('Public access');
  await expect(sidebar.locator('.side-user small')).toHaveText('Read only');
  await expect(page.locator('.topbar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await noWrites();
});
