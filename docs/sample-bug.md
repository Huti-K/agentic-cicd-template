### What happened

The thermal label roll is listed in inventory with barcode `0123456789012`, but scanning that exact barcode returns “Product not found.”

### Steps to reproduce

1. Open the Stockroom demo.
2. Click the **Label roll** sample button, or enter `0123456789012` and click **Look up**.
3. Observe that lookup fails even though the inventory table contains the product.
4. Click **Scanner** and observe that `4006381333931` works.

### Expected behavior

The label roll should be found with stock 24. Barcodes are exact string identifiers: leading zeros must be preserved. Whitespace around a scanner's input may be ignored, but scientific notation or other numeric spellings must not match a different barcode.

### Acceptance criteria

- [ ] `0123456789012` finds the label roll.
- [ ] ` 0123456789012 ` also finds the label roll.
- [ ] `123456789012` does not accidentally match the leading-zero identifier.
- [ ] Scientific notation and blank input cannot alias an existing barcode.
- [ ] A regression test fails before the fix and passes afterward.
- [ ] `npm run check` passes.

### Scope and context

Change only `demo/` and `tests/demo/`. Workflows, dependencies, instructions, credentials, and repository settings are out of scope. Preserve the successful scanner lookup and stock adjustment behavior.
