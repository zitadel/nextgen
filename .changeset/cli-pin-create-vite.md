---
"@zitadel/cli": patch
---

`zitadel setup` creates a new React, Vue, Solid, Svelte or Qwik app with `create-vite` 9.3.1 instead of the latest release. `create-vite` 9.3.2 was published without its templates, so setup created no app and then failed with "Could not detect a supported app framework".
