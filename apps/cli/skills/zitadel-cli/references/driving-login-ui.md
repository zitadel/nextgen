### Driving the login UI

`<zitadel-login>`, `<zitadel-session>`, and `<zitadel-logout>` are Lit elements
with open shadow roots. The stable automation hooks live inside nested shadow roots, so a flat
`document.querySelector('[data-testid="zitadel-input-email"]')` will not find
the native control. Browser drivers with shadow-DOM-aware locators, such as
Playwright, can target the hooks directly. Generic DOM-eval drivers should
pierce shadow roots recursively:

```js
function deepQuery(sel, root = document) {
  const hit = root.querySelector(sel);
  if (hit) return hit;
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) {
      const result = deepQuery(sel, el.shadowRoot);
      if (result) return result;
    }
  }
  return null;
}
```

Use host hooks such as `zitadel-field-email`, `zitadel-field-password`, and
`zitadel-action-submit` when targeting the Lit atoms. Use native shadow-control
hooks such as `zitadel-input-email`, `zitadel-input-password`, and
`zitadel-action-submit-button` when filling or clicking the underlying input or
button. Hooks stay method-named even when the flow engine names a credential
field `x-auth-methods#<method>`; only the `name` attribute carries that raw
form key. Enter inside a field submits the step's primary action, but only for
key events that carry `key: "Enter"` — drivers whose synthesized key events
omit it (some CDP wrappers) should click `zitadel-action-submit` instead.

For sign-out, the profile page that setup generates renders `<zitadel-session>`:
click its `zitadel-session-logout` host, or the native button inside it,
`zitadel-session-logout-button`. An app that renders `<zitadel-logout>` instead
hides sign-out behind an avatar menu: click the "Open user menu" button, then
pierce to `.signout-btn` (Playwright: `zitadel-logout .signout-btn`), which
carries no hook. A `<zitadel-logout>` with a `<template>` child shows no menu:
click the app's own element marked `data-action="logout"`. The canonical
component hook list lives in `packages/components/README.md`.

The checked-in automated regression path is `moon run e2e:journey`, which
exercises fresh-app setup plus registration, logout, and login across the
supported frameworks.

Repo config is authoritative: edit `zitadel.json` or files under `.zitadel/`,
then re-run `plan` and `apply`. Schema and flow files are synced from
`.zitadel/schemas/*.json` and `.zitadel/flows/*.json`. Login templates
(branding) are synced from `.zitadel/branding/`: a single `branding.json`
descriptor (layout, asset URLs) plus a sibling `login.liquid` LiquidJS
template referenced as `"liquid_template": { "$file": "./login.liquid" }`. Scaffold them with the
`branding eject` command (`--design centered|minimal`,
interactive picker on a TTY); setup never scaffolds them. Branding is
revisioned and immutable: every edit — including a `.liquid`-only edit —
plans as a `revise` and `apply` publishes a new revision; the login serves
the newest one. `plan` validates templates with the authoritative LiquidJS
validator (`E_VALIDATION` lists rule ids such as `no-script-tag` and
`mandatory-gates`; every template must keep a `{% mandatory_gates %}` tag,
where the login adds any required field and the primary action the template
left out). Asset URLs must be absolute `https://`; during development, images
may use `http://` on `localhost`, `127.x.x.x`, or `[::1]` (not `*.localhost`).
`typography.font_url` needs a `typography.font_family`, is always `https://`,
and is loaded only when the login runs as `variant="page"`, which setup
generates only when it creates a Next.js or Nuxt app itself, in an empty
directory. Keep exactly one descriptor in
`.zitadel/branding/` — extra `*.json` files there fail the scan.
Server-provisioned defaults remain a fallback for non-CLI project
creation, but CLI-created projects are authored from local files first. Flows are
revisioned like branding: an edit plans as a `revise` and `apply` publishes a new
immutable flow revision. A flow names its schema by `objectType` in
`user_schema` and runs against the schema's newest revision, so a schema revise
needs no change to `user_schema`; one that removes or renames a property a step
collects needs that step's `fields` updated, and `plan` checks only the flows it
uploads. A login pinned by `flow-name` serves that flow's newest active
revision; an unpinned login serves the newest active unscoped revision for its
purpose in the project, whatever its flow's name. Older revisions stay active,
so an `audience` added after a flow was applied without one doesn't take that
earlier revision out of the running. Removing a flow file does not retire the
flow. Managed files carry a marker comment; `eject` removes only
files that still carry it, preserving anything the user replaced. For app-local
development, `--server local` resolves through `.zitadel/local/runtime.json` and
requires a healthy
`npx @zitadel/cli@alpha start` runtime. The `.zitadel/local/` that `start`
writes into the directory still counts as empty, so a same-directory `setup`
scaffolds without `--force` (this is exactly what the golden path does).
`setup` installs dependencies
with the detected package manager by default; pass `--skip-install` when the
agent or host workflow will install dependencies separately.
