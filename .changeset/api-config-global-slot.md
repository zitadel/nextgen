---
"@zitadel/api": patch
---

Fix `configureZitadel()` so its state survives when more than one copy of `@zitadel/api/config` ends up loaded — the standalone components bundle inlines its own copy, and dual-package hazards / duplicate `node_modules` trees in a monorepo can load a second copy alongside the app's. Previously each module instance held its own `let currentProject`, so a `configureZitadel()` call in one was invisible to `getZitadelConfig()` in another and the components silently saw no config. The slot now lives on `globalThis` under a `Symbol.for(...)` key, which the global symbol registry resolves to the same symbol identity in every copy of the module evaluated in the same JS realm — separate realms (iframes, Node `vm` contexts, worker threads) still have their own registries.
