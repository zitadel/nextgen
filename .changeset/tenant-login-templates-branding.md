---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/config": minor
"@zitadel/components": patch
"@zitadel/cli": minor
---

Tenant-customizable login templates land end to end (ADR 040): eject a
design, edit real Liquid, `plan`/`apply` publishes it, and the login
renders it.

- `@zitadel/server`: new Branding API (`POST /branding`,
  `GET /branding`, `GET /branding/{id}`) storing immutable per-project
  branding revisions with a lexical template gate (size, encoding,
  `<script>`/`<style>`, inline handlers, `javascript:` URLs, `| raw`).
  Flow responses now resolve the latest revision per project instead of
  the hardcoded default.
- `@zitadel/api`: generated client and zod schemas for the Branding API.
- `@zitadel/config`: the authoritative LiquidJS template validator
  (`@zitadel/config/template`), the `branding.json` config dialect
  meta-schema, and the ejectable design catalog (`centered`, `split`,
  `split-right`, `minimal`) with `getDefaultBrandingConfig`.
- `@zitadel/components`: split/minimal layout chrome for the design
  catalog; the `{% mandatory_gates %}` tag name is now single-sourced
  from `@zitadel/config/template`.
- `@zitadel/cli`: `.zitadel/branding/` becomes a synced resource — a
  `branding.json` descriptor plus a sibling `login.liquid` the CLI
  inlines on upload. `zitadel branding eject [--design <name>]`
  scaffolds it, `zitadel setup --design <name>` does so at setup and
  publishes revision 1, and `plan`/`apply` validate templates with the
  authoritative validator and publish edits as new revisions.
