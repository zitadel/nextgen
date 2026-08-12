# Branding

This directory owns how your login UI looks: `branding.json` (layout preset
and asset URLs) plus `login.liquid`, the LiquidJS template the
`<zitadel-login>` component renders for every step.

## Workflow

1. Edit `login.liquid` (and `branding.json` for logo/font/hero URLs).
2. `zitadel plan` — validates the template (LiquidJS parse, banned patterns,
   the required `{% mandatory_gates %}` tag) and shows the pending revision.
3. `zitadel apply` — publishes an immutable branding revision. The login UI
   picks up the newest revision on the next step response.

Every edit publishes a new revision; there is no in-place update. Roll back
by re-applying an earlier template.

## Rules of the template

- Compose `<zl-*>` atoms and plain structural HTML. No `<script>`, no
  `<style>`, no inline event handlers — theming happens through design
  tokens, not template CSS.
- User-facing copy goes through translation keys: `{{ "key" | t }}`.
- Keep the trailing `{% mandatory_gates %}` tag: it appends any required
  field, gate, or submit action your template forgot, so a broken template
  still yields a submittable step.

## Make it yours

- In the split-family designs (`split`, `split-right`, `hero`) the
  `.zl-split__brand` pane is yours: structural HTML plus inline `style=""`
  attributes are allowed; `button`, `input`, and `form` tags are stripped —
  use `<a>` for landing CTAs. The `hero` design ships a full landing-page
  starting point on token-styled `zl-hero__*` classes.
- On narrow viewports the brand pane collapses and the `.zl-split__compact`
  node inside the form pane takes over (logo or brand line) — keep one so
  your identity survives on phones.
- The split chrome is tunable from your template root's `style` attribute
  (`--zl-split-columns`, `--zl-split-align`, `--zl-split-brand-mobile`), and
  `zl-split--right` on the wrapper mirrors the panes. Knob reference:
  [`docs/design/branding/templates.md`](https://github.com/zitadel/nextgen/blob/main/docs/design/branding/templates.md).
- The "Secured with Zitadel" attribution is licence-gated and on by default.
- Back-navigation: the engine injects a `kind: "back"` action on steps
  that can return to their predecessor, and the browser's back gesture
  submits it automatically — the shipped designs deliberately render **no
  visible back control**. Your template may render one if you want it;
  select the action by kind (never by name) and submit it like any other
  action:

  ```liquid
  {% assign back = actions | where: "kind", "back" | first %}
  {% if back %}
    <a href="#" class="zl-card-nav__link" data-action="{{ back.name }}">{{ back.text_key | t }}</a>
  {% endif %}
  ```

  If you list actions generically, exclude `a.kind == 'back'` from button
  loops so the injected action doesn't render as a stray secondary button.

Start over anytime with `zitadel branding eject --design <name>` (designs:
`centered`, `split`, `split-right`, `hero`, `minimal`; add `--force` to
overwrite).
