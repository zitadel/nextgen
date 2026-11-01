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
then re-run `deploy` (or `deploy --dry-run` to validate and preview the diff
without publishing). Schema and flow files are synced from
`.zitadel/schemas/*.json` and `.zitadel/flows/*.json`. Login templates
(branding) are synced from `.zitadel/branding/`: a single `branding.json`
descriptor (layout, asset URLs) plus a sibling `login.liquid` LiquidJS
template referenced as `"liquid_template": { "$file": "./login.liquid" }`. Scaffold them with the
`branding eject` command (`--design centered|minimal`,
interactive picker on a TTY); setup never scaffolds them. Branding is
revisioned and immutable: every edit — including a `.liquid`-only edit —
is published as part of the next release when you `deploy`, and the login
serves the release deployed to its origin. `deploy` validates templates with the authoritative
LiquidJS validator (and `deploy --dry-run` runs the same validation without
publishing; `E_VALIDATION` lists rule ids such as `no-script-tag` and
`mandatory-gates`; every template must keep a `{% mandatory_gates %}` tag,
where the login adds any required field and the primary action the template
left out). Asset URLs must be absolute `https://`; during development, images
may use `http://` on `localhost`, `127.x.x.x`, or `[::1]` (not `*.localhost`).
`typography.font_url` needs a `typography.font_family`, is always `https://`,
and is loaded only when the login runs as `variant="page"`, which setup
generates only when it creates a Next.js or Nuxt app itself, in an empty
directory. Keep exactly one descriptor in
`.zitadel/branding/` — extra `*.json` files there fail the scan.
A project created outside the CLI can start from server-provisioned defaults,
which serve nothing until a deployed release pins them. CLI-created projects are
authored from local files first. Flows are
revisioned like branding: an edit is published as a new immutable flow revision
in the next `deploy`. A flow names its schema by `objectType` in `user_schema`
and runs against the revision the release pins, so a schema revise needs no
change to `user_schema` and reaches sign-in with the next `deploy`; one that
removes or renames a property a step collects needs that step's `fields`
updated, and `deploy` checks each flow against the schema it names. A login
pinned by `flow-name` serves the revision of that flow the release pins; an
unpinned login serves the newest unscoped flow the release pins for its
purpose, whatever its name. Removing a flow file leaves it out of the next
release. Operation policies live in `.zitadel/policies/`: one `<operation>.json`
per guarded operation, named after its `operation`, holding
`{"$schema": "../meta/policy.json", "operation": "auth.factor.password.set",
"config": {"min_length": 15}}`. `deploy` checks each file against
`.zitadel/meta/policy.json` (known operation, only the template's settings,
within their bounds) and its name before anything is sent; settings that
contradict each other (a `min_length` above `max_length`) are refused by the
server's release build with `rel.invalid`, the policy's entry carrying
`pol.invalid`. A changed file publishes a new revision of the same policy,
which applies the next time a password is set. A setting left out is off, and
`"config": {}` switches every rule off. A sign-in or sign-up uses the policy
the deployed release carries, and a password set through the API the one the
newest primary deployment carries, so deploying without the file switches it
off. With no primary deployment, that API call answers `409` with
`rel.no_default`. `policies list` and
`policies get <id|operation>` read them back. A policy's cases live beside it
in `<operation>.test.json` (`.zitadel/meta/policy-test.json`): each names an
`input` in the operation's terms (`{"password": "…"}`), optional `facts` the
operation would look up (`self_service`, `history_matches`), and the expected
decision (`allowed`, optionally `code` and exactly the `violations`). The
decision and rules hold in the login too; `code` is the API's answer, and a
flow shows each rule as `error.x-auth-methods#password_<rule>` instead.
`policies test [operation]` evaluates every case on the server against the
sibling policy file, or with `--release <id>` against the revision that
release pins; a missing policy is tested as none. It fails with `E_VALIDATION`
(exit 3) when a case does not hold, `data`/`details` carrying `source`,
`operations[].cases[]` (`name`, `passed`, `expected`, `actual`), `passed` and
`failed`; with no test files it is `skipped` (`no-policy-tests`). `deploy`
never carries test files. Write cases from
what the user wants enforced; never invent expectations for them. `setup` writes and publishes
the password policy with a `min_length` of 15; pass `--password-min-length <n>`
only when the user asks for another value (`0` sets none). Managed files carry
a marker comment; `eject` removes only
files that still carry it, preserving anything the user replaced. For app-local
development, `--server local` resolves through `.zitadel/local/runtime.json` and
requires a healthy
`npx @zitadel/cli@latest start` runtime. The `.zitadel/local/` that `start`
writes into the directory still counts as empty, so a same-directory `setup`
scaffolds without `--force` (this is exactly what the golden path does).
`setup` installs dependencies
with the detected package manager by default; pass `--skip-install` when the
agent or host workflow will install dependencies separately.
