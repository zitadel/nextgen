# @zitadel/config

Versioned Zitadel local config schemas and defaults — the contract behind the
`.zitadel/` directory that `zitadel setup` scaffolds into your project.

## What's in here

| Import                                             | What it carries                                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@zitadel/config/schemas`                          | Zod schemas for the local config files (`schemaConfigSchema`, `flowConfigSchema`, `brandingConfigSchema`) |
| `@zitadel/config/branding-url`                     | Canonical loopback HTTP URL predicate shared by config and browser render gates                           |
| `@zitadel/config/validate`                         | Validation entry points the CLI runs on `plan`/`apply`                                                    |
| `@zitadel/config/normalize`                        | Normalization used to compare local files against server state                                            |
| `@zitadel/config/defaults`                         | The versioned default user schema, login flow, and branding designs                                       |
| `@zitadel/config/meta-schemas`                     | The JSON meta-schemas the defaults pin                                                                    |
| `@zitadel/config/template`                         | Liquid template helpers                                                                                   |
| `@zitadel/config/defaults/default-login.json`      | The default login flow — the authority for flow step shape                                                |
| `@zitadel/config/defaults/default-human-user.json` | The default user schema                                                                                   |

## The customer-facing part

`zitadel setup` copies the defaults into your repo as
`.zitadel/{schemas,flows,branding}/`, each with a README explaining how to
edit it (`defaults/README-schemas.md`, `README-flows.md`,
`README-branding.md` in this package become those files). Those files are
yours to edit; `zitadel plan` / `zitadel apply` reconcile them with the
server, and edits publish new revisions rather than mutating state in place.
