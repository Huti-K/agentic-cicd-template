# Reliable Relay browser scenarios

Inspect the actual rendered source and existing passing tests before choosing locators. Preserve acceptance criteria and use real browser interactions.

Keep this demo's tests small: normally one happy-path journey and one important edge case per feature. Reuse existing coverage. Avoid repeating the same journey for every role, page, color, and state. Assert exact CSS only for the specific visual change requested; unrelated semantic tag/status colors should stay distinct. Do not add exhaustive style/contrast audits to an ordinary feature ticket. Add more scenarios only for a concrete acceptance criterion or reported regression.

The normal suite runs every scenario on desktop and only tests tagged `@mobile` on mobile. Tag a focused scenario when the feature changes responsive layout or touch/navigation behavior. Independent evidence still records the current ticket's spec on both devices, so keep that spec concise.

Known browser interaction rules:
- Navigation counts form part of accessible link names. Use the actual accessible name, or a scoped stable destination selector such as `#sidebar a[href="#tickets"]` when appropriate. Do not assume an exact name of `Tickets` when a count is rendered.
- Mobile navigation slides for 200 ms. `aria-expanded` and visibility do not prove that it finished moving. Retry fresh bounding-box assertions with a finite `expect(...).toPass({timeout:3000})`; preserve positive width, left/right bounds, and document overflow assertions.
- The sidebar overlays part of the full-screen close-navigation backdrop. Its center may be covered. Use the supported Escape interaction and assert the menu is collapsed and backdrop hidden, or click an explicitly uncovered backdrop coordinate. Never use `force:true`.
- CSS colors, shadows, and geometry can change during transitions. Use retrying locator assertions or `expect.poll` around fresh computed values. Avoid immediate assertions on snapshots of animated state.

