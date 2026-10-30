# `.zitadel/flows/`

Flow definitions. Each JSON file describes an end-to-end journey —
which fields the user sees at each step, which credentials are checked,
and how one step transitions to the next. The Zitadel flow engine runs
these on the server; the widget renders whatever the engine emits.

Flow definitions and schemas work together: the user schema in
`.zitadel/schemas/` defines **what** data exists, the flow definition
decides **when and where** users are asked to provide it. If you add a
property to the schema, users won't see a new field until a step of a
flow definition lists it.

## What's in a flow definition

- `purposes` — entry step for each purpose (`login`, `register`, …). A
  single flow definition can serve multiple purposes.
- `steps[]` — the ordered list of screens. Each step's `fields[]`
  references properties of the flow definition's user schema (or reserved
  tokens like `x-auth-methods#password`), and `transitions` wires it to
  the next step.
- `user_schema` — the user schema the flow runs against, named by its
  `objectType`. The flow always uses that schema's newest revision.
- `audience` (optional) — scopes the flow definition to specific apps or
  teams.

## Making changes

The common workflow:

1. Edit the flow definition (and, if it needs new data, the schema in
   `.zitadel/schemas/` first).
2. Run `zitadel deploy --dry-run` to preview the change.
3. Run `zitadel deploy` to publish it.

Every deploy of an edited flow definition publishes a new immutable
revision. Earlier revisions stay readable by id, and stay active. A login
that pins the flow definition's name serves its newest active revision. A
login without a pin serves the project default: the project's newest
active unscoped revision for its purpose, whatever its name, so revising
a flow definition can make it the project default.

Typical edits:

- **Change which fields a step collects** — edit `steps[].fields[]`.
  Values must be properties of the pinned schema (or reserved credential
  tokens).
- **Add or remove a step** — extend `steps[]`.
- **Rewire transitions** — edit `steps[].transitions` to point at a
  different next step. Cross-flow jumps (`action: switch` / `pivot`)
  deploy, with a warning, but are **not yet executed by the runtime** —
  submitting through one fails with a 400 (`code: "flow.unsupported"`);
  keep transitions within one flow definition, using a purpose switch
  (next bullet) for login ↔ register navigation.
- **Offer a purpose switch in the card** — pair a `kind: navigate`
  action with a transition that declares a local `purpose`. The
  scaffolded `default-login.json` ships this in both directions:

  ```json
  "register": { "purpose": "register" }
  ```

  The transition goes to that purpose's entry step, so it needs no
  `target`. Navigation skips field validation (an empty email box can't
  block the link), and the declared purpose is what makes the landing leg
  run with the right semantics — register creates the user instead of
  trying to verify one. Rules: the purpose must be one this flow
  definition's `purposes` serves, a `target`, if you set one, must be that
  purpose's entry step, and `purpose` never combines with `action` (which
  targets another flow definition instead).
- **Choose whether the flow switches on its own** — the scaffolded flow
  wires two outcomes on its entry steps: `user_not_found` (an email with
  no account continues as a sign-up) and `user_already_exists` (an email
  that has an account continues a sign-up as a sign-in). Both are
  optional. Remove one, and that email stays on its step with an error
  instead (`error.user_not_found`, `error.user_already_exists`); the
  "Sign up" and "Sign in" links keep working. `zitadel deploy --dry-run`
  warns about a removed one, and never refuses it. To serve only one
  purpose, list only it in `purposes`.
- **Change or hide the switch notice** — after an automatic switch the
  login shows a notice saying why (`notice.user_not_found`,
  `notice.user_already_exists`, `notice.sso_user_not_found`). Change its
  text through the login's `locales`; set the text to `""` to show none.
- **Add another flow definition** — drop a new JSON file with its own
  `purposes` and a distinct `name` (e.g. a kiosk login). See
  [Multiple flow definitions](#multiple-flow-definitions) for how it gets
  selected at runtime.

## Multiple flow definitions

All files in this folder are published on `deploy`, but each sign-in in the widget
follows exactly one flow definition. Which one:

- **By name** — give the flow definition a distinct `name` and pass it as
  `flowName` on `ZitadelLogin` (the `flow-name` attribute on
  `<zitadel-login>`). The server resolves that definition directly,
  whatever its `audience`; an unknown name or wrong purpose surfaces as
  a startup error in the widget.
- **By the project default** — without `flowName`, the server serves the
  project default: the newest active revision that serves the requested
  purpose and has no `audience`. Older revisions count too, so adding an
  `audience` to a flow definition you already applied without one doesn't
  take that earlier revision out of the running.

`audience.app_ids` / `audience.team_ids` select a flow definition only
for callers of the flow API that send a matching `hint` (app match beats
team match). `<zitadel-login>` sends no hint, so for the widget an
`audience` does one thing: it keeps the flow definition out of the
project default. A scoped flow definition is still served when no
unscoped one serves the purpose.

The flip side: a **new active flow definition without an `audience`, or a
new revision of one, becomes the newest unscoped definition, i.e. the
project default for the purposes it serves**, the moment it deploys.
So an experiment can't silently take over `/login`, give the flow
definition an `audience` before its first `deploy` and select it by
`flowName`, or pin `flow-name` on the pages that should keep the current
project default.

## Presets

`zitadel setup` scaffolds this folder from a preset: `password-first` (the
default root files) or `--preset passkey-first`. The passkey-first flow
definition enters login on a fields-less passkey step with an email →
password fallback path. The preset only decides the starting point — edit
anything here afterwards.

## Schema revisions

Editing a schema publishes a new immutable revision, and every flow
definition naming its `objectType` uses it from then on, with no change
to the files, so `deploy` never rewrites anything locally. Update
`steps[].fields[]` yourself when the edit added or removed properties a
step should collect.
