# @zitadel/shared-component-styles

## 0.0.1-alpha.0

### Patch Changes

- [#603](https://github.com/zitadel/nextgen/pull/603) [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c) Thanks [@fforootd](https://github.com/fforootd)! - Expose `--zl-page-min-height` so host pages can size the embedded login widget to content (`auto`) instead of the default full-viewport page shape; releases both the orchestrator mount and the `zl-page-shell` atom.

- [#818](https://github.com/zitadel/nextgen/pull/818) [`310014f`](https://github.com/zitadel/nextgen/commit/310014f1ec8df441b161d12bb01658d27aa1f478) Thanks [@bastionstack](https://github.com/bastionstack)! - `theme="light"` now paints every part of the login surface, not just its resting colours. Hover, pressed and focus states on buttons, fields and selects re-theme with the mode, the card keeps a visible edge, and the attribution pill follows the light palette. Dark mode is unchanged.

  Three semantic tokens carry the interactive states: `--zl-color-surface-hover-strong`, `--zl-color-surface-hover-subtle` and `--zl-color-border-hover`. Surfaces should reach for these rather than the raw `--zl-color-gray-*` ramp, which is mode-independent by design and keeps its dark shade on a light page.

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

- [#603](https://github.com/zitadel/nextgen/pull/603) [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c) Thanks [@fforootd](https://github.com/fforootd)! - Flip `<zitadel-login>` to widget-first: the default `variant="widget"` is content-sized, transparent through every layer, injects no default font into the host document, and never steals focus on load — the embedding app owns the page. Dedicated login routes (hosted shell, scaffolded pages) opt into the previous full-page behavior with `variant="page"`. Split-family responsive chrome now keys off the widget's own width via container queries (baseline 2023 browsers), the hero design ships neutral placeholder copy instead of fabricated claims, and split tenants with only a `hero_url` keep a compact banner fallback on narrow widths.

- [#716](https://github.com/zitadel/nextgen/pull/716) [`65da8b1`](https://github.com/zitadel/nextgen/commit/65da8b18b8a1af4e484d7cf494f8142f0539fb41) Thanks [@fforootd](https://github.com/fforootd)! - fix: `variant="widget"` no longer pads around the card. The internal page shell kept its full-page padding chrome (52px vertical at desktop widths) in widget mode, so `<zitadel-login>`/`<zitadel-session>` embedded in an app's own container rendered with dead space above and below the card — a 682px host around a 514px card. Widget mode now sheds the shell padding along with the background and viewport sizing it already dropped, making the host box hug the card as the content-sized embedding contract promises. The shipped `minimal` branding design sheds its pane padding the same way (it has no card, so that padding was page chrome too); the split designs' pane padding is part of their composition and intentionally stays. `variant="page"` is unchanged everywhere.
