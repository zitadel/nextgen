---
"@zitadel/cli": patch
---

`zitadel setup` writes the Vite import it adds `loadEnv` to as formatters print it, `import { defineConfig, loadEnv } from 'vite'`, so a formatter no longer rewrites that line in your app.
