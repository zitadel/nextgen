# `.zitadel/flows/`

Flow definitions. Each JSON file describes an end-to-end journey —
which fields the user sees at each step, which credentials are checked,
and how one step transitions to the next. The Zitadel flow engine runs
these on the platform; the widget renders whatever the engine emits.

## Files here

- **`default-login.json`** — the default combined login/register flow,
  scaffolded during `zitadel setup`.
  - `purposes` names the entry step for each purpose (`login`,
    `register`, …).
  - `steps[]` is the ordered list of screens; each step's `fields[]`
    references properties of the pinned schema, and `transitions` wires
    it to the next step.
  - `user_schema` pins the flow to one specific user-schema revision.
  - `audience` (optional) scopes the flow to specific apps or teams.

## What you can do

- **Add or remove a step** — extend `steps[]`.
- **Change which fields a step collects** — edit `steps[].fields[]`.
  Values must be properties of the pinned schema (or reserved tokens
  like `x-auth-methods#password`).
- **Rewire transitions** — edit `steps[].transitions` to point at a
  different next step, or use `action: switch` / `pivot` to jump to
  another flow.
- **Add another flow** — drop a new JSON file with its own `purposes`
  and `audience` (e.g. a per-team login).

## Applying changes

`zitadel plan` previews the change; `zitadel apply` PUTs the updated
flow to the platform. When the pinned user-schema is edited, the flow
stays pinned to the old revision — `apply` prints the new revision id so
you can copy it into `user_schema` (and update `steps[].fields[]` for
any added/removed properties) when you're ready to adopt it.
