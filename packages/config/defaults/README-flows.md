# `.zitadel/flows/`

Flow definitions describe the login and register journeys. Each file pins to
one specific revision of a user-schema via `user_schema`.

## Editing rules

- **`user_schema`** is the full URL of one schema revision. The value is
  server-assigned; the CLI writes it here after the schema is created. The
  pinning is intentional — see below.
- **`steps[]`** lists the screens of the flow. Each step's `fields[]` names
  attributes from the pinned user-schema plus reserved credential tokens
  like `x-auth-methods#password`.

## The two-step schema/flow update

When you edit a user-schema and `zitadel apply` it, the server allocates a
**new** revision id. **This flow is left pinned to the previous revision.**
That is deliberate: if the new schema adds a required field, silently
switching the flow would break the register step until the flow's
`fields[]` catches up.

`apply` prints the new URL after publishing the revision:

```
⚠  New revision of user-schema `human-user` created.
   Update `user_schema` in these flow definitions to adopt it:
     - .zitadel/flows/default-login.json
```

To adopt the new revision:

1. Copy the URL from the warning into the flow's `user_schema`.
2. Add or remove the new required fields in the relevant step's `fields[]`.
3. `zitadel plan` to preview the flow update, then `zitadel apply`.
