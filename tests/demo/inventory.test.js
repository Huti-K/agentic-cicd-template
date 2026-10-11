import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, findProduct, inventorySummary, updateStock } from '../../demo/src/inventory.js';

test('finds the scanner by its barcode', () => {
  assert.equal(findProduct(catalog, '4006381333931').name, 'Handheld scanner');
});
test('unknown scans return null', () => {
  assert.equal(findProduct(catalog, '9999999999999'), null);
});
test('stock updates return a new inventory without changing the original', () => {
  const next = updateStock(catalog, '4006381333931', -2);
  assert.equal(next[1].stock, 6);
  assert.equal(catalog[1].stock, 8);
});
test('stock cannot become negative or fractional', () => {
  assert.throws(() => updateStock(catalog, '4006381333931', -9), /Not enough stock/);
  assert.throws(() => updateStock(catalog, '4006381333931', 0.5), /whole number/);
  assert.equal(catalog[1].stock, 8);
});
test('unsafe integer stock changes are rejected without changing inventory', () => {
  const original = structuredClone(catalog);
  for (const change of [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_SAFE_INTEGER + 1, -Number.MAX_SAFE_INTEGER - 1]) {
    assert.throws(() => updateStock(catalog, '4006381333931', change), /safe integer/);
    assert.deepEqual(catalog, original);
  }
});
test('stock updates that exceed the safe integer limit leave inventory unchanged', () => {
  const original = structuredClone(catalog);
  assert.throws(() => updateStock(catalog, '4006381333931', Number.MAX_SAFE_INTEGER - 7), /safe integer/);
  assert.deepEqual(catalog, original);
});
test('safe stock changes work at the safe integer boundary', () => {
  const original = structuredClone(catalog);
  const next = updateStock(catalog, '4006381333931', Number.MAX_SAFE_INTEGER - 8);
  assert.equal(next[1].stock, Number.MAX_SAFE_INTEGER);
  assert.equal(updateStock(next, '4006381333931', 0)[1].stock, Number.MAX_SAFE_INTEGER);
  assert.equal(updateStock(next, '4006381333931', -Number.MAX_SAFE_INTEGER)[1].stock, 0);
  assert.deepEqual(catalog, original);
});
test('stock updates reject missing products without changing inventory', () => {
  const original = structuredClone(catalog);
  assert.throws(() => updateStock(catalog, '9999999999999', 1), /Product not found/);
  assert.deepEqual(catalog, original);
});
test('summary counts all stock', () => {
  assert.deepEqual(inventorySummary(catalog), { products: 3, units: 152 });
});
