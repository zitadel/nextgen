---
"@zitadel/cli": patch
---

`setup` moves a dependency from `devDependencies` into `dependencies` instead of listing it in both. A package the app already had in `devDependencies` was added a second time, and some toolchains refuse a package listed twice. A runtime dependency is never demoted: when the app already lists a package in `dependencies` and a dev add arrives, it stays where it is, and `peerDependencies` and `optionalDependencies` entries are left alone.
