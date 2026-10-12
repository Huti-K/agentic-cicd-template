import { test, expect } from '@playwright/test';
import { installPlatformAPI, ticketFixture } from '../helpers/platform-api.js';

// API-backed fixtures exercise the browser contract; no live GitHub writes occur.
const emptyCount = '0 of 12,000 characters used · 12,000 remaining';
const counterIn = form => form.locator('#ticket-form-description-counter');

async function expectReadableLayout(page, form) {
  const description = form.getByLabel('Description', { exact: true });
  const counter = counterIn(form);
  await counter.scrollIntoViewIfNeeded();
  await expect(counter).toBeVisible();
  const fieldBox = await description.boundingBox(), counterBox = await counter.boundingBox();
  expect(counterBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);
  expect(counterBox.x).toBeGreaterThanOrEqual(0);
  expect(counterBox.x + counterBox.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(await form.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const submit = form.getByRole('button', { name: /^(Create ticket|Save changes)$/ });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeVisible();
  const buttonBox = await submit.boundingBox(), countBox = await counter.boundingBox();
  expect(buttonBox.y).toBeGreaterThanOrEqual(countBox.y + countBox.height);
}

test('fixture-backed new editor counts input in place and retains native validation and layout', async ({ page }) => {
  const api = await installPlatformAPI(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New ticket', exact: true });
  const description = form.getByLabel('Description', { exact: true }), counter = counterIn(form);
  await expect(counter).toHaveText(emptyCount);
  await expect(description).toHaveAttribute('aria-describedby', 'ticket-form-description-counter');
  await expect(counter).toHaveAttribute('aria-live', 'polite');
  await expect(counter).toHaveAttribute('aria-atomic', 'true');
  expect(await description.evaluate(node => node.nextElementSibling.id)).toBe('ticket-form-description-counter');
  await expect(description).toHaveAttribute('maxlength', '12000');
  expect(await description.evaluate(node => node.required)).toBe(true);
  await expectReadableLayout(page, form);

  await description.fill('');
  await description.pressSequentially('abc');
  await expect(counter).toHaveText('3 of 12,000 characters used · 11,997 remaining');
  // insertText exercises insertion of a text chunk without clipboard permissions.
  await page.keyboard.insertText('\n😀 ');
  await expect(description).toHaveValue('abc\n😀 ');
  await expect(counter).toHaveText('7 of 12,000 characters used · 11,993 remaining');
  await description.press('Backspace');
  await expect(counter).toHaveText('6 of 12,000 characters used · 11,994 remaining');

  // A paste input event must update only the counter, preserving caret/selection.
  const selection = await description.evaluate(node => {
    node.value = '  A\r\n😀  ';
    node.setSelectionRange(2, 5);
    const before = [node.selectionStart, node.selectionEnd];
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    return { before, after: [node.selectionStart, node.selectionEnd] };
  });
  expect(selection.after).toEqual(selection.before);
  await expect(description).toBeFocused();
  await expect(description).toHaveValue('  A\n😀  ');
  await expect(counter).toHaveText('8 of 12,000 characters used · 11,992 remaining');
  await description.fill('<img src=x onerror=alert(1)>');
  await expect(counter.locator('img')).toHaveCount(0);
  await expect(counter).toHaveText('28 of 12,000 characters used · 11,972 remaining');

  await description.fill('x'.repeat(11999));
  await description.press('End');
  await page.keyboard.insertText('xy');
  await expect(description).toHaveValue('x'.repeat(12000));
  await expect(counter).toHaveText('12,000 of 12,000 characters used · 0 remaining');
  await expectReadableLayout(page, form);
  await description.fill('');
  await expect(counter).toHaveText(emptyCount);
  await form.getByLabel('Title', { exact: true }).fill('Required description');
  await form.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await expect(form).toBeVisible();
  expect(await description.evaluate(node => node.validity.valueMissing)).toBe(true);
  expect(api.requests.filter(request => request.method === 'POST')).toEqual([]);
});

test('fixture-backed edit initializes each ticket independently and saves the existing version and trimmed payload', async ({ page }) => {
  const api = await installPlatformAPI(page);
  api.detail.ticket.description = '  A\r\n😀  ';
  await page.goto('/#ticket/RLY-1');
  // The nested original request also has .prose; assert only the current description.
  await expect(page.locator('.description-card > .prose')).toHaveText('  A\n😀  ');
  await page.getByRole('button', { name: 'Edit ticket', exact: true }).click();
  let form = page.getByRole('dialog', { name: 'Edit ticket', exact: true });
  await expect(form.getByLabel('Description', { exact: true })).toHaveValue('  A\n😀  ');
  await expect(counterIn(form)).toHaveText('8 of 12,000 characters used · 11,992 remaining');
  await expectReadableLayout(page, form);
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();

  api.detail.ticket = ticketFixture({ id: 'RLY-9', version: 7, title: 'Another ticket', description: 'Other description' });
  await page.goto('/#ticket/RLY-9');
  await expect(page.getByRole('heading', { name: 'Another ticket', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit ticket', exact: true }).click();
  form = page.getByRole('dialog', { name: 'Edit ticket', exact: true });
  await expect(counterIn(form)).toHaveText('17 of 12,000 characters used · 11,983 remaining');
  await form.getByLabel('Description', { exact: true }).fill('  Updated\n😀  ');
  await expect(counterIn(form)).toHaveText('14 of 12,000 characters used · 11,986 remaining');
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(form).not.toBeVisible();
  const request = api.requests.find(item => item.method === 'PATCH');
  expect(request.path).toBe('/api/tickets/RLY-9');
  expect(request.body).toMatchObject({ description: 'Updated\n😀', version: 7 });
  expect(request.body).not.toHaveProperty('type');
  expect(request.headers['x-csrf-token']).toBe(api.csrfToken);
  await expect(page.getByRole('heading', { name: 'Another ticket', exact: true })).toBeVisible();
  await expect(page.locator('.description-card > .prose')).toHaveText('Updated\n😀');
  expect(api.detail.ticket.id).toBe('RLY-9');
  await page.getByRole('button', { name: 'Edit ticket', exact: true }).click();
  await expect(counterIn(form)).toHaveText('10 of 12,000 characters used · 11,990 remaining');
});

for (const scenario of ['create outage', 'edit outage', 'edit conflict']) {
  test(`fixture-backed ${scenario} preserves the draft and matching count`, async ({ page }) => {
    const api = await installPlatformAPI(page), editing = scenario.startsWith('edit');
    await page.goto(editing ? '/#ticket/RLY-1' : '/');
    await page.getByRole('button', { name: editing ? 'Edit ticket' : 'New ticket', exact: true }).click();
    const form = page.getByRole('dialog', { name: editing ? 'Edit ticket' : 'New ticket', exact: true });
    const draft = '  Keep my\n😀 draft  ', before = structuredClone(api.detail.ticket);
    await form.getByLabel('Title', { exact: true }).fill('Preserved request');
    await form.getByLabel('Description', { exact: true }).fill(draft);
    await expect(counterIn(form)).toHaveText('20 of 12,000 characters used · 11,980 remaining');
    if (scenario === 'edit conflict') api.conflict = true;
    else api.failure = { path: editing ? '/api/tickets/RLY-1' : '/api/tickets', method: editing ? 'PATCH' : 'POST', error: 'Save temporarily unavailable.' };
    const submit = form.getByRole('button', { name: editing ? 'Save changes' : 'Create ticket', exact: true });
    await submit.click();
    await expect(form).toContainText(scenario === 'edit conflict' ? 'Your draft is still here.' : 'Save temporarily unavailable.');
    await expect(submit).toBeEnabled();
    await expect(form.getByLabel('Description', { exact: true })).toHaveValue(draft);
    await expect(counterIn(form)).toHaveText('20 of 12,000 characters used · 11,980 remaining');
    expect(api.detail.ticket).toEqual(before);
    await expectReadableLayout(page, form);
    api.conflict = false;
    api.failure = null;
    await submit.click();
    await expect(form).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Preserved request', exact: true })).toBeVisible();
    const writes = api.requests.filter(request => request.method === (editing ? 'PATCH' : 'POST'));
    expect(writes).toHaveLength(2);
    for (const request of writes) {
      expect(request.body.description).toBe(draft.trim());
      expect(request.headers['x-csrf-token']).toBe(api.csrfToken);
      if (editing) expect(request.body.version).toBe(before.version);
      else {
        expect(request.body.type).toBe('feature');
        expect(request.body).not.toHaveProperty('version');
      }
    }
    expect(api.detail.ticket.description).toBe(draft.trim());
  });
}

test('fixture-backed public visitors must sign in before opening a ticket editor', async ({ page }) => {
  const api = await installPlatformAPI(page, { authenticated: false });
  await page.goto('/');
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Maintainer sign-in' })).toBeVisible();
  await expect(page.locator('#ticket-form-description')).toHaveCount(0);
  expect(api.requests.filter(request => request.method !== 'GET')).toEqual([]);
});
