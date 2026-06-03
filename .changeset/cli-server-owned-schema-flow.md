---
"@zitadel-nextgen/cli": minor
"@zitadel-nextgen/sdk-next": patch
---

`zitadel setup` no longer scaffolds or uploads the user schema and flow definition — the Zitadel server now provisions these defaults when a project is created. Setup no longer writes `.zitadel/schemas/user.json` or `.zitadel/flows/default.json`, runs no sync step at the end, and the `--no-apply` flag (which only gated that sync) has been removed. The sync engine and the hidden `apply`/`plan` commands remain in place for a future pull-based workflow.

**Behavior change for non-interactive callers.** `zitadel setup --no-apply` is no longer a valid flag and will error; remove it from scripts and agents.

Scaffolded Next.js login/register/profile pages now configure the SDK via `configureZitadel(...)` and pass the resulting project handle to the `<zitadel-login>` / `<zitadel-logout>` web components through the `project` prop, instead of the removed `api-base` / `project-id` attributes. To support an app that declares only `@zitadel-nextgen/sdk-next` as a direct dependency, `@zitadel-nextgen/sdk-next/client` now re-exports `configureZitadel` and `getApi`.
