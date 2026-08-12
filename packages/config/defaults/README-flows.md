# `.zitadel/flows/`

Flow definitions. Each JSON file describes an end-to-end journey —
which fields the user sees at each step, which credentials are checked,
and how one step transitions to the next. The Zitadel flow engine runs
these on the platform; the widget renders whatever the engine emits.

Flows and schemas work together: the user schema in
`.zitadel/schemas/` defines **what** data exists, the flow defines
**when and where** users are asked to provide it. If you add a property
to the schema, users won't see a new field until a flow step lists it.

## What's in a flow file

- `purposes` — entry step for each purpose (`login`, `register`, …). A
  single flow can serve multiple purposes.
- `steps[]` — the ordered list of screens. Each step's `fields[]`
  references properties of the pinned schema (or reserved tokens like
  `x-auth-methods#password`), and `transitions` wires it to the next
  step.
- `user_schema` — pins the flow to one specific user-schema revision.
- `audience` (optional) — scopes the flow to specific apps or teams.

## Making changes

The common workflow:

1. Edit the flow (and, if it needs new data, the schema in
   `.zitadel/schemas/` first).
2. Run `zitadel plan` to preview the change.
3. Run `zitadel apply` to publish it.

Typical edits:

- **Change which fields a step collects** — edit `steps[].fields[]`.
  Values must be properties of the pinned schema (or reserved credential
  tokens).
- **Add or remove a step** — extend `steps[]`.
- **Rewire transitions** — edit `steps[].transitions` to point at a
  different next step. Cross-flow jumps (`action: switch` / `pivot`)
  validate in a definition but are **not yet executed by the runtime** —
  submitting through one fails with a 400 (`code: "unsupported"`); keep
  transitions within one flow for now.
- **Add another flow** — drop a new JSON file with its own `purposes`
  and a distinct `name` (e.g. a per-team login). See
  [Multiple flows](#multiple-flows) for how it gets selected at runtime.

## Multiple flows

All files in this folder sync on `apply`, but the widget runs exactly
one flow per sign-in. Which one:

- **By name** — give the flow a distinct `name` and pass it as
  `flowName` on `ZitadelLogin` (the `flow-name` attribute on
  `<zitadel-login>`). The platform resolves that definition directly;
  an unknown name or wrong purpose surfaces as a startup error in the
  widget.
- **By audience** — omit `flowName` and scope the flow with
  `audience.app_ids` / `audience.team_ids`. A start request hinting one
  of those ids gets the scoped flow (app match beats team match); all
  other requests get the newest flow without an `audience`.

A flow scoped to an app or team never captures the project default —
requests that don't identify that audience fall back to the unscoped
flow.

The flip side: a **new active flow without an `audience` becomes the
newest unscoped definition, i.e. the default**, the moment it applies.
`plan` calls this out with a `# warning:` line on the create so an
experiment can't silently take over `/login` — scope it or pin
`flow-name` in the widget if that isn't the intent.

## Presets

`zitadel setup` scaffolds this folder from a preset: `password-first` (the
default root files) or `--preset passkey-first`. The passkey-first flow
enters login on a fields-less passkey step with an email → password
fallback path. The preset only decides the starting point — edit
anything here afterwards.

## Schema revisions

Editing a schema publishes a new immutable revision. When you `apply` a
schema edit, the CLI rewrites `user_schema` in the flow files pinned to
the old revision and updates the flows in the same run — the plan
announces the re-pin beforehand, and the rewrite shows up in your git
diff. Remember to update `steps[].fields[]` yourself when the edit
added or removed properties the flow should collect.
