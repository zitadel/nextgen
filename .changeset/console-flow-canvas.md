---
"@zitadel/server": minor
"@zitadel/components": minor
---

The console's login flow screen draws the flow as a canvas: a card per step sketching its fields and actions in the project's branding, and a named arrow per transition. It zooms by Ctrl or ⌘ and the wheel, a pinch or the keyboard, pans by drag, opens full screen, and isolates a step's transitions in and out on hover or focus.

`@zitadel/components` exports `brandingDeclarations(branding, side)`, the `--zl-*` values a branding revision paints for one side, for hosts that set them on an element rather than adopting the stylesheet.
