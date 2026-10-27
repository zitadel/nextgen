---
"@zitadel/cli": patch
---

`zitadel setup` creates React, Vue, Solid, Svelte and Qwik apps again: it pins `create-vite` 9.3.1, since 9.3.2 was published without its templates and setup then failed with "Could not detect a supported app framework".
