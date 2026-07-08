# `.zitadel/schemas/`

User-schema files. A user schema defines **what** the platform stores
about a user and how that user type can authenticate. The login flows in
`.zitadel/flows/` define **when and where** users are asked to provide
that data. The two work together: a flow's `steps[].fields` must name
properties of the schema it pins via `user_schema`.

A project can hold as many schemas as you need — one JSON file per user
type (e.g. `default-human-user.json` for end users, `admin.json` for
internal admins).

## What's in a schema file

A trimmed example:

```json
{
  "objectType": "human-user",
  "properties": {
    "email": { "type": "string", "format": "email" },
    "givenName": { "type": "string" }
  },
  "required": ["email"],
  "x-auth-methods": {
    "password": { "enabled": true, "position": 1 },
    "passkey": { "enabled": true, "position": 2 }
  }
}
```

- `objectType` — identifies this user type. Do not rename it after the
  first `apply`; the platform correlates revisions of the same logical
  user type by this key.
- `properties` — the information stored for users of this type. Every
  property becomes available to the rest of the identity system,
  including login and registration flows.
- `required` — which properties every user must provide; everything else
  is optional.
- `x-auth-methods` — how users of this type can authenticate (password,
  passkey, …) and in which order the methods are offered.

## Making changes

The common workflow:

1. Edit the schema file.
2. If you added, removed, or renamed properties, update the login flow
   in `.zitadel/flows/` too — the schema defines what data *exists*, the
   flow defines which screens *collect* it. A new property does not show
   up on the registration form until a flow step lists it in `fields`.
3. Run `zitadel plan` to preview the change.
4. Run `zitadel apply` to publish it.

Editing a schema publishes a **new immutable revision** — existing users
keep validating against the previous revision, and nothing breaks
retroactively. See `.zitadel/flows/README.md` for how flows adopt a new
revision.

## Common changes

- **Add a field** — add it under `properties` (e.g. a `company`
  string). Add it to `required` if every user must provide it, and list
  it in a flow step's `fields` if users should be able to enter it.
- **Make a field optional or required** — add/remove it in `required`.
- **Enable or disable an auth method** — flip the `enabled` value of an
  `x-auth-methods` entry.
- **Add another user type** — drop a new JSON file next to this one.
