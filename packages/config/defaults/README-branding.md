# Branding

This directory owns the structure of your login widget: `branding.json`
(asset URLs and appearance) plus `login.liquid`, the LiquidJS template the
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
  field and the primary action your template left out, so the step stays
  submittable.

## Fields

Render a field by its name only; the component fills in the rest from the
step after every render:

```liquid
{% for f in fields %}
  {% case f.type %}
  {% when 'checkbox' %}<zl-checkbox name="{{ f.name }}"></zl-checkbox>
  {% when 'select' %}<zl-select name="{{ f.name }}"></zl-select>
  {% else %}<zl-field name="{{ f.name }}"></zl-field>
  {% endcase %}
{% endfor %}
```

| Filled in | From | On |
|---|---|---|
| `label` | the field's `text_key`, translated | all |
| `data-testid` | `zitadel-field-<name>` | all |
| `error`, `invalid` | the step's error for this field, translated | all |
| `value` | the server's prefilled value (`checked` on a checkbox) | all |
| `type`, `autocomplete`, `required` | the step's field | `zl-field` |
| `placeholder` | `<text_key>.placeholder` | `zl-field`, `zl-select` |
| help text | `<text_key>.help`, as a `<span slot="help">` | `zl-field` |
| `options`, `required` | the field's allowed values | `zl-select` |
| `forgot-password-href`, `-action`, `-label` | the step's `recover` action | password `zl-field` |

What you write wins. An attribute in your template is never overwritten, so
`<zl-field name="{{ f.name }}" label="Work email">` keeps your label while
everything else is still filled in. To leave something out, write it empty:
`placeholder=""` shows no placeholder, `forgot-password-href=""` hides the
forgot-password link, and your own `<span slot="help">` replaces the filled
help. Wording changes that apply to every design belong in the `locales`
prop, not the template.

Templates that bind every attribute themselves (ejected before fields were
filled in) keep working unchanged.

## Make it yours

- Brand asset URLs go in `branding.json` and must use `https://`. Each template
  decides which fields it renders: `centered` uses `logo_url`; `minimal` uses
  none until you add it to `login.liquid`. Set the typeface with
  `typography.font_family`. `typography.font_url` is loaded when the component
  runs as `variant="page"`, which the sign-in pages `zitadel setup` generates
  use: the component then adds that stylesheet to your page. With
  `variant="widget"` it is not loaded, and your page loads the font.

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
  as an invisible image. So `zitadel plan` probes `logo_url` and `hero_url` and warns
  (never fails) when it is unreachable, bodyless, or not an image, and the
  login UI hides an asset that fails to load, restoring the shipped design's
  no-asset content rather than leaving a gap. If the host is only
  reachable from where the login page renders — or you are offline — set
  `ZITADEL_SKIP_ASSET_PROBE=1` to skip the check. The probe contacts public
  HTTPS destinations only and re-checks redirects; loopback/private/internal
  targets are left to the browser-side fallback instead of being requested by
  the machine running `plan`.

  `layout` is **not** a design picker. The shipped template does not read it,
  so changing it alone changes nothing on screen. Both shipped designs
  (`centered`, `minimal`) carry `centered`. Switch designs with
  `zitadel branding eject --design <name>`, don't edit `layout`.

- The "Secured with Zitadel" attribution is always shown, and `branding.json`
  has no setting for it. It sits at the foot of the login; to place it
  elsewhere, put
  `<div data-zl-attribution-anchor></div>` where you want it in `login.liquid`.
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
