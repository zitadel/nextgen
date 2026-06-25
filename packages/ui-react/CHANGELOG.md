# @zitadel/ui-react

## 0.1.0-alpha.1

### Minor Changes

- [#390](https://github.com/zitadel/nextgen/pull/390) [`2c32a90`](https://github.com/zitadel/nextgen/commit/2c32a90b41bdc7da736a2c3be0e8e851dbe59333) Thanks [@bastionstack](https://github.com/bastionstack)! - Add the `Checkbox` and `Select` atoms in both renderers, and render the
  `checkbox` and `select` field types in the orchestrator.
  - `@zitadel/components`:
    - New form-associated `<zl-checkbox>` Lit atom (Figma `Checkbox` `4387:460`,
      `Checkbox / With Label` `6634:1868`): optional `label` (or default slot),
      `checked` / `disabled` / `required` / `value` / `name`, a `zl-change` event,
      and full form participation (`setFormValue` / `setValidity` / reset / focus
      delegation).
    - New form-associated `<zl-select>` Lit atom (Figma `Dropdown` `4397:4816`,
      `Input text` `4397:4098`): a select-only combobox following the WAI-ARIA
      pattern with keyboard navigation. Options accept either a JS array
      (`.options`) or a JSON `options` attribute; `value` / `placeholder` /
      `disabled` / `required` and a `zl-change` event.
    - New `chevron-down` icon.
    - Both atoms registered in the manifest registry.
    - Orchestrator: the default Liquid template now renders `select` and
      `checkbox` field types as `<zl-select>` / `<zl-checkbox>`; select options
      are built from the field's `validation.enum` via a new `selectOptions`
      filter.
  - `@zitadel/ui-react`: new paired `<Checkbox>` and `<Select>` React components
    that mirror the Lit atoms' DOM and share their surface CSS.

  Shared `checkbox.css` and `select.css` (+ their `lit/*-host.css`) were added to
  `@zitadel/shared-component-styles`. No new design tokens were required.

## 0.1.0-alpha.0

### Minor Changes

- [#116](https://github.com/zitadel/nextgen/pull/116) [`c9b83b7`](https://github.com/zitadel/nextgen/commit/c9b83b7a2f17d196ddf7152079d73286d22d4eba) Thanks [@bastionstack](https://github.com/bastionstack)! - Introduce the design-token-driven foundation for the auth surface, replacing
  the demo styling baseline:
  - New `@zitadel/design-tokens` package — the single producer of the
    `--zl-*` CSS variable layer, the typed `tokens` / `cssVars` constants,
    and the Tailwind v4 `@theme` block. Backed by a version-pinned
    `figma-tokens.lock`, a Figma REST sync script, and a manual-trigger
    GitHub workflow that opens PRs with regenerated outputs. A snapshot
    test locks the public token surface.
  - New `@zitadel/ui-react` package — visually identical paired React components
    of every Lit atom (`<Button>`, `<TextField>`, `<Alert>`, `<Pill>`,
    `<Icon>`, `<Card>`, `<PageShell>`). Used by the internal Zitadel console
    and ships a single `styles.css` that consumes the design-token variables.
  - `@zitadel/components`:
    - Drop the legacy `<zl-submit>`, `<zl-action>`, `<zl-error>` atoms and
      the hand-rolled `src/tokens/` catalogue.
    - Add `<zl-button>` (full Figma matrix, form-associated), `<zl-alert>`,
      `<zl-pill>`, `<zl-icon>`, `<zl-card>`, `<zl-page-shell>`. Rebuild
      `<zl-field>` against the Figma Text Field spec.
    - Add `passkey-upsell` and `signed-in` Liquid templates and rewrite the
      default + auth-form templates to compose `<zl-page-shell>` →
      `<zl-card>` with the new atoms.
    - Rewrite `branding-to-tokens` to fan branding palette/density/radius
      onto the new `--zl-*` namespace and add `branding.attribution` for
      "Secured with Zitadel" footer control. Default theme switches from
      light to dark to match the published Figma variable mode.

### Patch Changes

- Updated dependencies [[`c9b83b7`](https://github.com/zitadel/nextgen/commit/c9b83b7a2f17d196ddf7152079d73286d22d4eba)]:
  - @zitadel/design-tokens@0.1.0-alpha.0
