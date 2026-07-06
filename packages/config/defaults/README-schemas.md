# `.zitadel/schemas/`

User-schema files. Each JSON file describes one editable user type — the
shape of the user records the platform stores and the login/register
flows collect (email, name, phoneNumber, custom claims, etc.). A project
can hold as many schemas as you need (e.g. one for end users, one for
internal admins).

## Files here

- **`default-human-user.json`** — the default schema for human users,
  scaffolded during `zitadel setup`.
  - `properties` / `required` describe the user's attributes.
  - `x-auth-methods` declares which credentials this user type supports
    (password, passkey, …).
  - `objectType` groups revisions of the same logical user type; do not
    rename it after the first `apply`.

## What you can do

- **Add or edit a property** — extend `properties`, mark it `required`
  if it must be present on every user.
- **Enable or disable an auth method** — flip an `x-auth-methods` entry.
- **Add another user type** — drop a new JSON file next to this one.

## Applying changes

`zitadel plan` previews the change; `zitadel apply` publishes it. Editing
a schema publishes a **new immutable revision** — existing users keep
validating against the previous revision. Flows that reference this
schema stay pinned to the old revision until you re-pin them; see
`.zitadel/flows/README.md`.
