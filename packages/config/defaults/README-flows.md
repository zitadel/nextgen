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
  different next step, or use `action: switch` / `pivot` to jump to
  another flow.
- **Add another flow** — drop a new JSON file with its own `purposes`
  and `audience` (e.g. a per-team login).

## Schema revisions

Editing a schema publishes a new immutable revision. When you `apply` a
schema edit, the CLI rewrites `user_schema` in the flow files pinned to
the old revision and updates the flows in the same run — the plan
announces the re-pin beforehand, and the rewrite shows up in your git
diff. Remember to update `steps[].fields[]` yourself when the edit
added or removed properties the flow should collect.
