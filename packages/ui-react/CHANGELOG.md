# @zitadel/ui-react

## 0.1.0-alpha.2

### Patch Changes

- [#404](https://github.com/zitadel/nextgen/pull/404) [`ca91e8f`](https://github.com/zitadel/nextgen/commit/ca91e8f0368a59f9b96df2f380ec708b3b678f6c) Thanks [@vitorbari](https://github.com/vitorbari)! - Login flow: enforce required fields client-side and show inline errors on every control.
  - Submit-type `<zl-button>` now delegates to the form, so the primary action
    can't bypass validation; non-submit buttons keep emitting `zl-submit` for
    ungated navigation (back, skip, passkey, sign-in/register switch).
  - On submit the orchestrator checks the step's `required` fields via each atom's
    live `formValue` (so autofill that skipped `input` events is still seen) and
    surfaces an empty one through the server's own `error.<field>_required`
    dialect — styled and localised exactly like a backend rejection, with no
    native validation bubble. Checkboxes are excluded: a rendered checkbox always
    submits a real boolean (`false` when unticked), so a must-accept boolean is a
    schema concern (`const: true`), keeping browser and API clients aligned.
  - Field errors render inline under every control type, not just email/password:
    `<zl-select>` and `<zl-checkbox>` gained an `error` / `invalid` contract (with
    React `Select` / `Checkbox` parity, including a generated fallback id so the
    error stays wired to the control via `aria-describedby`). Selected values and
    checkbox states survive an error re-render.

- [#404](https://github.com/zitadel/nextgen/pull/404) [`ca91e8f`](https://github.com/zitadel/nextgen/commit/ca91e8f0368a59f9b96df2f380ec708b3b678f6c) Thanks [@vitorbari](https://github.com/vitorbari)! - Login flow: render and submit `select` and `checkbox` user-schema fields.
  - The default template renders `select` / `checkbox` field types as
    `<zl-select>` / `<zl-checkbox>`.
  - `<zl-select>` / `<Select>` are agent-first: a real native `<select>` is the
    operable, accessible, automatable control, with the Figma-styled trigger kept
    as a pointer-only visual layer. Screen readers, keyboard users, password
    managers and automation drivers can now pick an option (e.g. enum schema
    fields during CLI-driven registration).
  - The orchestrator captures every input atom through a uniform `formValue`
    contract, so `<zl-select>` and `<zl-checkbox>` submit the right shape: a
    checkbox as a real JSON boolean, a select as its chosen enum member, with
    empty enum values omitted so an untouched optional select isn't rejected by
    the server's enum check.
  - The leading placeholder row drops any empty-valued member the schema enum
    itself lists, so no duplicate empty option is rendered.
  - The styled popup closes on `Escape` for pointer users (keyboard users already
    get this from the native `<select>`).
  - The `{% mandatory_gates %}` safety net recognises `<zl-select>` /
    `<zl-checkbox>`, so a required select or checkbox no longer gets a duplicate
    generic text field appended.

- Updated dependencies [[`04704fb`](https://github.com/zitadel/nextgen/commit/04704fb1a019aa3041aa37f8c9f23dbc27d4fee3), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`310014f`](https://github.com/zitadel/nextgen/commit/310014f1ec8df441b161d12bb01658d27aa1f478), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`ca91e8f`](https://github.com/zitadel/nextgen/commit/ca91e8f0368a59f9b96df2f380ec708b3b678f6c), [`ca91e8f`](https://github.com/zitadel/nextgen/commit/ca91e8f0368a59f9b96df2f380ec708b3b678f6c), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`65da8b1`](https://github.com/zitadel/nextgen/commit/65da8b18b8a1af4e484d7cf494f8142f0539fb41)]:
  - @zitadel/design-tokens@0.1.0-alpha.1
  - @zitadel/shared-component-styles@0.0.1-alpha.0

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
