# `.zitadel/schemas/`

One JSON file per user type. The filename is a label for humans; the server
assigns each schema a unique id when you run `zitadel apply`.

## Editing rules

- **`objectType` is the correlation key.** Every revision of the same user
  type shares one `objectType` value (e.g. `human-user`). Do not rename it
  after the first `apply` — the server groups revisions under this key, so
  changing it would fork history.
- **Never set `$id` manually.** The id is server-assigned per revision. The
  CLI records it in `.zitadel/state.json` and reads it back on the next run.
- **`x-auth-methods`** at the root declares which credentials this user type
  supports; `properties` and `required` describe the attribute shape.

## What `zitadel apply` does when you edit this file

Every `apply` that detects a change here **publishes a new immutable
revision**. The previous revision keeps validating users that were created
against it — there is no destructive update, and no user is invalidated by
your edit.

Adopting the new revision on an existing flow is a separate, manual step —
`apply` prints the new URL and names the flow files that still point at the
previous revision. See `.zitadel/flows/README.md` for how to re-pin them.
