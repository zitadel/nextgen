# Branding

This directory owns how your login UI looks: `branding.json` (layout preset
and asset URLs) plus `login.liquid`, the LiquidJS template the
`<zitadel-login>` component renders for every step.

## Workflow

1. Edit `login.liquid` (and `branding.json` for logo/hero URLs).
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

- Brand asset URLs go in `branding.json` and must use `https://`. Each template
  decides which fields it renders: `centered` and `hero` use `logo_url`; `split`
  and `split-right` use both `logo_url` and `hero_url`; `minimal` uses neither
  until you add them to `login.liquid`. The `hero` design's brand pane is
  editable markup rather than a `hero_url` background. Custom fonts are not
  configurable here yet; load them from the embedding page.

  ```json
  {
    "$schema": "../meta/branding.json",
    "layout": "split",
    "liquid_template_file": "./login.liquid",
    "logo_url": "https://example.com/logo.svg",
    "hero_url": "https://example.com/hero.jpg"
  }
  ```

  A well-formed URL that serves nothing is the one branding mistake nothing
  else catches — it passes validation, publishes a revision, and then renders
  as an invisible image. So `zitadel plan` fetches each asset URL and warns
  (never fails) when it is unreachable or does not answer with an image, and
  the login UI hides an asset that fails to load, falling back to the split
  designs' decorative panel rather than leaving a gap. If the host is only
  reachable from where the login page renders — or you are offline — set
  `ZITADEL_SKIP_ASSET_PROBE=1` to skip the check.

  `layout` is the degrade preset (`centered` or `split`), **not** the complete
  design catalog. All named designs (`centered`, `split`, `split-right`, `hero`,
  `minimal`) are delivered as templates and map onto those two values. Switch
  designs with `zitadel branding eject --design <name>`, don't edit `layout`.

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
