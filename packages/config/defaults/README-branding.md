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

Start over anytime with `zitadel branding eject --design <name>` (designs:
`centered`, `split`, `split-right`, `minimal`; add `--force` to overwrite).
