export const catalog = [
  { barcode: '0123456789012', name: 'Thermal label roll', location: 'A-01', stock: 24, category: 'Labels' },
  { barcode: '4006381333931', name: 'Handheld scanner', location: 'B-03', stock: 8, category: 'Hardware' },
  { barcode: '5901234123457', name: 'Shipping carton', location: 'C-02', stock: 120, category: 'Packaging' },
];

export function findProduct(products, input) {
  const barcode = String(input).trim();
  return products.find((product) => product.barcode === barcode) ?? null;
}

export function updateStock(products, barcode, change) {
  if (!Number.isInteger(change)) throw new Error('Quantity must be a whole number.');
  if (!Number.isSafeInteger(change)) throw new Error('Quantity must be a safe integer.');
  const product = products.find((item) => item.barcode === barcode);
  if (!product) throw new Error('Product not found.');
  const stock = product.stock + change;
  if (stock < 0) throw new Error('Not enough stock.');
  if (!Number.isSafeInteger(stock)) throw new Error('Stock must be a safe integer.');
  return products.map((item) => item.barcode === barcode ? { ...item, stock } : { ...item });
}

export function inventorySummary(products) {
  return { products: products.length, units: products.reduce((sum, item) => sum + item.stock, 0) };
}
