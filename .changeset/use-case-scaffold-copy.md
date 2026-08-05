---
"@zitadel/cli": minor
---

`zitadel setup --use-case business` now wires the SDK's `businessLocales` overlay into the generated Next login/register pages, restoring work-email wording on top of the widgets' neutral built-in copy (assigned via a ref so it holds on React 18, and `doctor --fix` regenerates the same markup from the recorded use case). The generated profile pages leave page chrome to the session card's `variant="page"` surface instead of hardcoding viewport height and background, every scaffolded page names the `variant="widget"` embedding alternative in a comment, and the scaffolded AGENTS.md guidance points at the widgets' variant/theme knobs and the SDK-shipped JSX types.
