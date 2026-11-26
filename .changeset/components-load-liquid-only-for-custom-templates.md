---
"@zitadel/components": patch
---

`<zitadel-login>` no longer ships the LiquidJS template engine to pages that use the default template. The default template is compiled when the package builds and renders the same HTML as before; the engine now loads in its own chunk only when the branding sets `liquid_template`, and the loader shows until it has loaded. `standalone.mjs` is now minified, which takes it from 806 KB to 404 KB (202 KB to 108 KB gzip).
