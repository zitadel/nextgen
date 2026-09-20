---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/components": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
"@zitadel/cli": patch
---

Session responses identify their user through a resolved **user ref** derived
from the user schema's own `x-identifier`/`x-display` designations (ADR 058),
replacing the convention-resolved flat `name`/`email` fields this supersedes
(see the earlier `GET /sessions/me` identity changeset). Rendering follows one
chain everywhere: `display`, falling back to `identifier`, then `user_id`.

- `@zitadel/server`: `GET /sessions/me`, session get, and query sessions embed
  `user` (`{user_id, identifier, identifier_property, display}`), the list
  path hydrated with one batch resolution per page — listed sessions now carry
  user identity at all. The conventional attribute-name resolver
  (`name`/`givenName`+`familyName`/`email`) is removed.
- `@zitadel/api`: the regenerated client types the new `user` ref component.
- `@zitadel/components`: `<zitadel-session>`/`<zitadel-logout>` render from
  the ref; the `zitadel-signout` detail is now `{display, identifier}`;
  logout templates substitute `{{display}}`/`{{identifier}}` (the old
  `{{name}}`/`{{email}}` tokens keep filling as aliases).
- `@zitadel/sdk-core` (and every SPA SDK via the shared contract):
  `NextgenSession`/`ClientSession` become `{userId, identifier,
  identifierProperty, display}`; JWT-claim identities map `name` → `display`
  and `email` → `identifier`.
- `@zitadel/sdk-next` / `@zitadel/sdk-nuxt`: server and client session reads
  return the new shape.
- `@zitadel/cli`: scaffolded Nuxt auth plugins emit the new fields.

**Breaking:** the flat `name`/`email` session fields and the old SDK session
shape are gone. An unknown property is dropped rather than rejected, so a
client left on the old fields reads silently empty values instead of failing
loudly — update server, SDKs, and app chrome together.
