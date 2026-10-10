import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, findProduct, inventorySummary, updateStock } from '../../demo/src/inventory.js';

test('finds the scanner by its barcode', () => {
  assert.equal(findProduct(catalog, '4006381333931').name, 'Handheld scanner');
});
for (const input of ['0123456789012', ' 0123456789012 ']) {
  test(`finds the label roll with barcode ${JSON.stringify(input)}`, () => {
    const product = findProduct(catalog, input);
    assert.ok(product);
    assert.equal(product.name, 'Thermal label roll');
    assert.equal(product.stock, 24);
  });
}
for (const input of ['123456789012', '4.006381333931e12', '4006381333931.0', '', '   ']) {
  test(`does not alias a barcode from ${JSON.stringify(input)}`, () => {
    const products = [...catalog, { barcode: '0', name: 'Zero barcode', stock: 1 }];
    assert.equal(findProduct(products, input), null);
  });
}
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
test('summary counts all stock', () => {
  assert.deepEqual(inventorySummary(catalog), { products: 3, units: 152 });
});
