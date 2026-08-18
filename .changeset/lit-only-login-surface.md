---
"@zitadel/components": minor
---

The login surface is Lit-only, and the console composes shadcn/ui (ADR 052). `@zitadel/ui-react` and `@zitadel/shared-component-styles` are removed: each atom's CSS now lives beside it as `packages/components/src/atoms/zl-<atom>.css`, with the shadow-host rules merged into the same file, and `@zitadel/components` gains `IconSize`, `IconTone`, `ZITADEL_ATTRIBUTION_LOGOTYPE_SVG` and `zitadelAttributionPillInnerHtml` on its public surface. The `--zl-*` variables from `@zitadel/design-tokens` remain the only contract the two surfaces share, so nothing about theming, tenant branding, or the `part`/`exportparts` styling hooks changes. Consumers importing `@zitadel/ui-react` should compose shadcn/ui, or embed `<zitadel-login>` or the atom itself as a custom element.
