---
"@zitadel/server": patch
"@zitadel/components": major
---

The login widget paints the appearance a branding revision publishes.

An element `theme` now selects among the sides a revision publishes, and cannot reach one it did not: with a single published side the property has no effect. An embedder pinning `theme="light"` against a dark-only revision gets the dark side.

Each theme side keeps its own colours: a light key no longer leaks into the dark surface, and the mark comes from the resolved side, so a wordmark drawn for a light card is never placed on a dark one. A revision that publishes one side renders that side only — `auto`, the visitor's operating system, and the element's `theme` property can all ask for the other one, and it is not there to give.

`shape.radius` accepts the pixel value the contract allows, and scales the whole corner ramp in proportion rather than only the three middle steps, so `none` now squares off checkboxes and fields too. `shape.logo_scale` multiplies the logo height caps. `typography.scale` reaches the text sizes and their leading, so the multiplier changes what the surface renders at.

`Branding` and its member types are now the wire shapes rather than a parallel client declaration. `BrandingAssets` is removed from the package's exported types, along with the `assets` block it described: `logo_dark`, `favicon` and `background_image` were only ever validated, never rendered. A per-side `theme.light.logo_url` / `theme.dark.logo_url` replaces the first, and the other two have no successor. The client-only `typography.font_family_heading` and `font_family_mono` go the same way — a revision carries one face, and a page with a licensed display face points `--zl-font-family-heading` at it directly.
