# Reliable Relay browser scenarios

Inspect the actual rendered source and existing passing tests before choosing locators. Preserve acceptance criteria and use real browser interactions.

Known browser interaction rules:
- Navigation counts form part of accessible link names. Use the actual accessible name, or a scoped stable destination selector such as `#sidebar a[href="#tickets"]` when appropriate. Do not assume an exact name of `Tickets` when a count is rendered.
- Mobile navigation slides for 200 ms. `aria-expanded` and visibility do not prove that it finished moving. Retry fresh bounding-box assertions with a finite `expect(...).toPass({timeout:3000})`; preserve positive width, left/right bounds, and document overflow assertions.
- The sidebar overlays part of the full-screen close-navigation backdrop. Its center may be covered. Use the supported Escape interaction and assert the menu is collapsed and backdrop hidden, or click an explicitly uncovered backdrop coordinate. Never use `force:true`.
- CSS colors, shadows, and geometry can change during transitions. Use retrying locator assertions or `expect.poll` around fresh computed values. Avoid immediate assertions on snapshots of animated state.

