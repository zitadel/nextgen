---
"@zitadel/config": minor
---

Shared contrast rules for branding palettes.

`@zitadel/config/branding-contrast` names the pairs a login surface puts next to each other, the ratio each has to reach, and measures a palette against them, so the console, the CLI and the server call the same pair an issue. Thresholds are WCAG 2.2 AA: 4.5:1 for text, 3:1 for the outline of a control.

`@zitadel/config/css-color` resolves the colour forms a palette accepts to sRGB. Every form the contract stores is measurable: named colours, hex with alpha, `rgb`, `hsl`, `hwb`, `lab`, `lch`, `oklab`, `oklch`, `color()`, and `color-mix()` including its percentage and hue-interpolation rules. `currentColor` resolves against the colour the caller says it inherits, which for a palette is the side's own text.

Translucent values are composited before measuring, since the ratio depends on what a value sits on. A pair whose backdrop is unknowable — a translucent page background, with the host application behind it — is reported as unchecked rather than passed.
