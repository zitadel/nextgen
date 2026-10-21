---
"@zitadel/cli": minor
---

Releases now publish to npm's `latest` tag as `0.x` preview versions, starting at `0.1.0`, instead of `1.0.0-alpha.N` under `alpha`: run the CLI as `npx @zitadel/cli@latest` and install the SDKs with `@latest`. The `1.0.0-alpha.N` versions are deprecated on npm. Until 1.0.0, a breaking change ships in a minor version and its release note starts with **Breaking:**. `zitadel setup` pins the `@zitadel/*` packages it adds, and the commands it suggests, to the CLI's exact version on every release, and `zitadel start --runtime docker` runs the server image of that version.
