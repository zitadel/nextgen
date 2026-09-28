# Branding

This directory owns the structure of your login widget: `branding.json`
(layout preset and asset URLs) plus `login.liquid`, the LiquidJS template the
`<zitadel-login>` component renders for every step. The page around the
widget (a split screen, a hero pane, marketing copy) belongs in your
application, not in this template.

## Workflow

1. Edit `login.liquid` (and `branding.json` for the logo URL).
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
  decides which fields it renders: `centered` uses `logo_url`; `minimal` uses
  none until you add it to `login.liquid`. Custom fonts are not configurable
  here yet; load them from the embedding page.

  ```json
  {
    "$schema": "../meta/branding.json",
    "layout": "centered",
    "liquid_template": { "$file": "./login.liquid" },
    "logo_url": "https://example.com/logo.svg"
  }
  ```

  A well-formed URL that serves nothing is the one branding mistake nothing
  else catches — it passes validation, publishes a revision, and then renders
  as an invisible image. So `zitadel plan` probes each asset URL and warns
  (never fails) when it is unreachable, bodyless, or not an image, and the
  login UI hides an asset that fails to load, restoring the shipped design's
  no-asset content rather than leaving a gap. If the host is only
  reachable from where the login page renders — or you are offline — set
  `ZITADEL_SKIP_ASSET_PROBE=1` to skip the check. The probe contacts public
  HTTPS destinations only and re-checks redirects; loopback/private/internal
  targets are left to the browser-side fallback instead of being requested by
  the machine running `plan`.

  `layout` is the degrade preset the login falls back to when a template is
  rejected, **not** a design picker. Both shipped designs (`centered`,
  `minimal`) map onto `centered`. Switch designs with
  `zitadel branding eject --design <name>`, don't edit `layout`.

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
`centered`, `minimal`; add `--force` to overwrite).
