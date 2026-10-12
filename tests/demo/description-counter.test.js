import test from 'node:test';
import assert from 'node:assert/strict';
import { descriptionCounterText } from '../../demo/src/platform-core.js';

test('description counter shows the empty, populated and full editor counts', () => {
  assert.equal(descriptionCounterText('', 12000), '0 of 12,000 characters used · 12,000 remaining');
  assert.equal(descriptionCounterText('Existing request', 12000), '16 of 12,000 characters used · 11,984 remaining');
  assert.equal(descriptionCounterText('x'.repeat(12000), 12000), '12,000 of 12,000 characters used · 0 remaining');
});

test('description counts include whitespace, normalized newlines and UTF-16 Unicode units', () => {
  assert.equal(descriptionCounterText('  A\n😀  ', 12000), '8 of 12,000 characters used · 11,992 remaining');
  assert.equal(descriptionCounterText(' \n ', 12000), '3 of 12,000 characters used · 11,997 remaining');
  assert.equal(descriptionCounterText('<img src=x>', 12000), '11 of 12,000 characters used · 11,989 remaining');
});

test('counter uses the supplied textarea maximum and never reports negative space', () => {
  assert.equal(descriptionCounterText('hello', 10), '5 of 10 characters used · 5 remaining');
  assert.equal(descriptionCounterText('x'.repeat(12001), 12000), '12,001 of 12,000 characters used · 0 remaining');
});
