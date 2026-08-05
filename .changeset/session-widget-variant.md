---
"@zitadel/components": minor
---

`<zitadel-session>` is now embeddable and themable like `<zitadel-login>`: it shares the same surface contract with `variant` (default `widget` — content-sized, transparent, no font injection; `page` claims the viewport and paints the surface via its internal page shell) and `theme` (`light` / `dark` / `auto`, resolved against the variant fallback instead of hardcoding dark). `<zitadel-logout>` also resolves `theme` now instead of pinning `data-theme="dark"`. Breaking within the alpha: `<zitadel-session>` no longer renders page-like by default — dedicated signed-in routes must set `variant="page"`.
