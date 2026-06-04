---
"@zitadel/cli": minor
---

Drop unused auth methods from the `zitadel setup` prompt and consolidate flow domain logic into `apps/cli/src/lib/flows/`. The setup prompt previously offered `passkey`, `password`, and `totp` as a multiselect, but `totp` is not a valid key under `x-auth-methods` per the OAS spec (only `password|passkey|magic_link|sso|otp` are allowed with `additionalProperties: false`), so any user schema written with `totp` selected failed validation. The Go flow engine only wires `password` and `identifier` challenges today; `passkey` has a defined JSON shape but no runtime handler yet.

**Breaking change for non-interactive callers.** The `--auth-methods` flag (CSV) has been renamed to `--auth-method` (single value); allowed values are `passkey` (default) or `password`. Agents and scripts that previously passed `--auth-methods password` must update to `--auth-method password`.

Internally, the flow_definition shape (Zod schema, types, build, read/write, text-key extraction) now lives behind a single `apps/cli/src/lib/flows/` module exported through one barrel. The sync layer remains shape-agnostic and treats flow payloads as opaque bytes. A follow-up PR will introduce `apps/cli/src/lib/user-schema/` mirroring the same layout.
