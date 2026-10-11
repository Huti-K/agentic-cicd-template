import { test, expect } from '@playwright/test';

test('all sample products scan, including a leading-zero barcode', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  for (const [button, name] of [['Scanner', 'Handheld scanner'], ['Label roll', 'Thermal label roll'], ['Carton', 'Shipping carton']]) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(page.getByRole('status')).toContainText(`Found ${name}`);
  }
  await page.getByLabel('Product barcode').fill('4.006381333931e12');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByRole('status')).toContainText('Product not found');
  expect(errors).toEqual([]);
});
test('shipping the last unit succeeds; overshipping leaves stock unchanged; reset restores it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scanner', exact: true }).click();
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Ship one' }).click();
  await expect(page.getByRole('status')).toContainText('now has 0 in stock');
  await page.getByRole('button', { name: 'Ship one' }).click();
  await expect(page.getByRole('status')).toHaveText('Not enough stock.');
  await expect(page.locator('#unit-count')).toHaveText('144');
  await page.getByRole('button', { name: 'Reset inventory' }).click();
  await expect(page.locator('#unit-count')).toHaveText('152');
  await expect(page.locator('#adjustments')).toBeHidden();
});
test('the pipeline page renders actual run data and handles API outages', async ({ page }) => {
  await page.route('https://api.github.com/repos/**/actions/runs?*', (route) => route.fulfill({ json: {
    workflow_runs: [{ name: 'CI', display_title: 'Verify stock fix', status: 'completed', conclusion: 'success',
      html_url: 'https://github.com/Huti-K/agentic-cicd-template/actions/runs/123', head_branch: 'main', head_sha: 'a'.repeat(40), created_at: '2026-10-11T09:00:00Z' }],
  } }));
  await page.goto('/pipeline.html');
  await expect(page.locator('#runs')).toContainText('Verify stock fix');
  await expect(page.locator('#runs')).toContainText('Passed');
  await expect(page.locator('#build-commit')).not.toHaveText('Loading…');
  await page.route('https://api.github.com/repos/**/actions/runs?*', (route) => route.fulfill({ status: 403, json: { message: 'Rate limit' } }));
  await page.getByRole('button', { name: 'Refresh runs' }).click();
  await expect(page.getByRole('status')).toContainText('unavailable');
  await expect(page.locator('#runs')).not.toContainText('Verify stock fix');
});

