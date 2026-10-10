import { catalog, findProduct, updateStock, inventorySummary } from './inventory.js';

let inventory = structuredClone(catalog);
let selected = null;
const form = document.querySelector('#scan-form');
const input = document.querySelector('#barcode');
const status = document.querySelector('#status');

function render() {
  const summary = inventorySummary(inventory);
  document.querySelector('#product-count').textContent = summary.products;
  document.querySelector('#unit-count').textContent = summary.units;
  const list = document.querySelector('#inventory');
  list.replaceChildren();
  for (const product of inventory) {
    const row = document.createElement('tr');
    for (const value of [product.name, product.barcode, product.location, product.stock]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    list.append(row);
  }
  document.querySelector('#adjustments').hidden = !selected;
  if (selected) document.querySelector('#selected-name').textContent = selected.name;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  selected = findProduct(inventory, input.value);
  status.textContent = selected ? `Found ${selected.name} · ${selected.stock} in stock` : 'Product not found. Check the barcode and try again.';
  status.dataset.state = selected ? 'success' : 'error';
  render();
});

document.querySelectorAll('[data-scan]').forEach((button) => {
  button.addEventListener('click', () => {
    input.value = button.dataset.scan;
    form.requestSubmit();
  });
});

document.querySelectorAll('[data-change]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!selected) return;
    try {
      inventory = updateStock(inventory, selected.barcode, Number(button.dataset.change));
      selected = inventory.find((item) => item.barcode === selected.barcode);
      status.textContent = `${selected.name} now has ${selected.stock} in stock.`;
      status.dataset.state = 'success';
      render();
    } catch (error) {
      status.textContent = error.message;
      status.dataset.state = 'error';
    }
  });
});
document.querySelector('#reset').addEventListener('click', () => {
  inventory = structuredClone(catalog);
  selected = null;
  status.textContent = 'Inventory reset. Ready to scan.';
  status.dataset.state = '';
  render();
});
render();
