---
"@zitadel/server": patch
"@zitadel/components": minor
---

The login widget paints the appearance a branding revision publishes.

Each theme side keeps its own colours: a light key no longer leaks into the dark surface, and the mark comes from the resolved side, so a wordmark drawn for a light card is never placed on a dark one. A revision that publishes one side renders that side only — `auto`, the visitor's operating system, and the element's `theme` property can all ask for the other one, and it is not there to give.

`shape.radius` accepts the pixel value the contract allows, and scales the whole corner ramp in proportion rather than only the three middle steps, so `none` now squares off checkboxes and fields too. `shape.logo_scale` multiplies the logo height caps. `typography.scale` reaches the text sizes and their leading, so the multiplier changes what the surface renders at.

`Branding` and its member types are now the wire shapes rather than a parallel client declaration. `BrandingAssets` is gone with the `assets` block it described, which never painted anything; per-side logos replace it.
