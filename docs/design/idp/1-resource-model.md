# IdP Resource Model

> **Status:** Planning notes  
> **Epic:** [zitadel/nextgen#851](https://github.com/zitadel/nextgen/issues/851)  
> **Area:** 1 of 9 (see [`README.md`](README.md))

An Identity Provider (IdP) connection is a tenant-owned configuration file that defines how Zitadel interacts with external authentication providers (such as Google or GitHub).

This document defines the schema, validation rules, runtime behavior, and lifecycle of these connection files.

**Note on vocabulary:**  
Commands `plan` and `apply` will be replaced by `deploy/promote/status/pull`
(see [#542](https://github.com/zitadel/nextgen/issues/542)).
Read "at plan" as "at validation" and "at apply" as "at
deployment".

## IdP Connection Shape

A connection operates similarly to a flow definition within the Zitadel GitOps surface. Setup scaffolds a prefilled file, and the tenant owns it entirely afterward.

### File Structure & Identity
**Location**: One file per connection, stored under `.zitadel/idps/`.

**Identity** (`slug`): The `slug` is the stable identifier referenced by user schemas and flow steps.

**Schema:** Validated against a Zitadel-published JSON Schema (e.g., `idp-connection.json`).

## Key Decisions

| Decision                                                  | Why                                                                                                                       |
|-----------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------|
| Files under `.zitadel/idps/`                              | Maintains consistent GitOps surface area.                                                                                 |
| Based on Zitadel-defined JSON Schema                      | Same pattern as `flow-definition.json`                                                                                    |
| Validation                                                | Schema checks single-file rules; a separate validator handles cross-file rules.                                           |
| Protocol details live in a nested `oidc` / `oauth2` block | New protocols add a block instead of restructuring committed files                                                        |
| `slug` is the identity                                    | User schemas and flow definitions reference connections by slug, so revisions never invalidate references                 |
| `revisioned: true`                                        | In-flight attempts, rollback, and audit need immutable revisions                                                          |
| `claim_mapping`                                           | Driven by properties in a tenant-defined user schema; mapping is data, not code.                                          |
| Environment Secrets                                       | The secret values are not configured in the connection file. How the value reaches the engine is an open question         |
| Vendor Configurations                                    | Vendor differences are treated as data, not hardcoded branches; see [Vendor knowledge is data](#vendor-knowledge-is-data) |

## Vendor knowledge is data

Most vendor-specific implementation is configuration. The model prioritizes configuration for data, named strategies for behavior.

### Context
zitadel/zitadel implements each vendor as a Go package. Google is 53 lines: an issuer
URL, one authorize parameter, one username rule. GitLab is 47 lines of endpoints.
Most of that code is configuration written in Go.

| Provider | LOC | What is actually vendor-specific |
|---|---|---|
| [Google](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/google/google.go) | 53 | issuer, `prompt=select_account`, username falls back to email |
| [GitLab](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/gitlab/gitlab.go) | 47 | endpoints |
| [Zitadel](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/zitadel/zitadel.go) | 33 | issuer |
| [AzureAD](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/azuread/azuread.go) | 361 | tenant-templated URLs, forced scopes, claim mapping |
| [GitHub](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/github/github.go) | 308 | endpoints, userinfo mapping, private-email fetch |
| [Apple](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/apple/apple.go) | 145 | `form_post` response mode, signed client secret |

The packages sit on five protocol engines: [`oidc`](https://github.com/zitadel/zitadel/tree/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/oidc) (349 LOC),
[`oauth`](https://github.com/zitadel/zitadel/tree/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/oauth) (346), [`jwt`](https://github.com/zitadel/zitadel/tree/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/jwt) (317), [`saml`](https://github.com/zitadel/zitadel/tree/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/saml) (606),
[`ldap`](https://github.com/zitadel/zitadel/tree/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/ldap) (796).

Across all six vendors, only three things are behaviour rather than data:

1. GitHub fetches `/user/emails` when the profile email is private, and keeps only a
   `primary && verified` address; reference implementation:
   * the trigger and scope check: [`session.go#L46-L67`](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/github/session.go#L46-L67) 
   * the fetch and the `Primary && Verified` filter: [`session.go#L96-L112`](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/github/session.go#L96-L112)
   * the `/emails` suffix: [`github.go#L20`](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/github/github.go#L20)
2. Apple signs its own client secret (an ES256 JWT, minted at construction,
   [`apple.go#L30`](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/apple/apple.go#L30), with a one-hour expiry, so a future
   implementation caches and refreshes; the signer is
   [`apple.go#L45-L67`](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/apple/apple.go#L45-L67)).
3. Apple uses `response_mode=form_post`, which turns the callback into a POST
   ([`apple.go#L34`](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/apple/apple.go#L34)).

### Proposal
So the proposal is: **configuration for everything data-shaped, named strategies for the rest.**

Some providers require custom actions during sign-in, which we call **strategies**. 
The server implements the logic for each strategy once and stores it in a **registry**, 
a mapping of unique names to their specific implementations and contracts. 
A connection activates one of these extra steps simply by referencing its registry name 
(e.g., "supplementary_fetch": "github_primary_email"). 
While standard configuration fields handle static data, 
only a named strategy can introduce new execution steps. 
If a connection doesn't select a strategy, it defaults to the standard protocol flow.

While this mechanism is built for general use, 
Epic 851 introduces just `supplementary_fetch` to support GitHub.
Currently, `github_primary_email` is its only entry, as GitHub is the only provider in this release requiring a custom action. 
Google’s setup, by contrast, is entirely data-driven. 
When Apple is integrated later, its signed secret will introduce a second slot (`secret_strategy`). 
Using this registry approach prevents us from hardcoding `if provider == "github"` branches in the core engine,
which is exactly the hardcoded pattern this design aims to remove.

**Two rules keep this mechanism predictable:**

**Registry entries carry strict contracts:** 
A strategy declares its protocols, required scopes, emitted claims, and verified properties. 
For instance, `github_primary_email` requires `oauth2` and `user:email`, while emitting/verifying email.
The JSON schema enforces the name, protocol, and scope parts of these contracts via closed enums and conditional checks, 
causing typos or unshipped strategies to fail at validation; the verified-properties part is a validator rule. Adding a new strategy is a non-breaking change.

**Strategies are the definitive authority:** If selected, a strategy always runs, 
replacing any same-named claims from userinfo or the `id_token`. 
For example, GitHub's default userinfo might return a hidden or unverified public email, 
while the fetch strategy guarantees a primary verified address. 
Running the strategy unconditionally ensures stable connection behavior 
rather than relying on user-specific profile quirks. This guarantees that `verified_claims: {"email": "$supplementary_fetch"}` always resolves correctly, 
at the cost of one additional HTTP request per login.

While the list of behavioral edge cases will grow as new providers are added, 
the architectural boundary stays intact. 
Every new behavior is isolated to one registry entry and one enum value,
ensuring that each new vendor is always implemented as pure configuration data.

**Provider plumbing differences dictate a few specific configuration fields:**

* `token_endpoint_auth_method`: Providers differ on authentication methods (`client_secret_basic` vs. `client_secret_post`). 
While the schema defaults to `client_secret_basic`, scaffolded files hardcode the provider's actual requirement (e.g., GitHub pins `client_secret_post`).

* `pkce_enabled`: This manages PKCE support. For example, GitHub's OAuth flow historically ignores PKCE parameters, 
making `true` harmless but ineffective. However, if a provider actively rejects these parameters, 
it requires an explicit `false`.

**Rule of thumb:** Always verify these configuration pins against the live provider before shipping the defaults. 
A wrong pin will pass validation but fail at the first sign-in.

## Example

Setup scaffolds one file per selected provider.

<details open>
<summary><code>.zitadel/idps/google.json</code> - OIDC, discovery supplies the endpoints</summary>

```jsonc
// .zitadel/idps/google.json - OIDC: discovery supplies the endpoints
{
  "$schema": "../meta/idp-connection.json",
  "slug": "google",
  "protocol": "oidc",
  "template": "google",
  "display_name": "Google",
  "subject_claim": "sub",
  "claim_mapping": {
    "email": "email",
    "givenName": "given_name",
    "familyName": "family_name"
  },
  "verified_claims": {
    "email": "email_verified"
  },
  "provisioning": {
    "is_creation_allowed": true,
    "is_auto_creation": false
  },
  "oidc": {
    "issuer": "https://accounts.google.com",
    "client_id": "1234-abc.apps.googleusercontent.com",
    "client_secret_env": "GOOGLE_CLIENT_SECRET",
    "scopes": [
      "openid",
      "profile",
      "email"
    ],
    "static_authorize_parameters": {
      "prompt": "select_account"
    }
  }
}
```

</details>

<details open>
<summary><code>.zitadel/idps/github.json</code> - OAuth2, endpoints explicit</summary>

```jsonc
// .zitadel/idps/github.json - OAuth2: no discovery, endpoints explicit
{
  "$schema": "../meta/idp-connection.json",
  "slug": "github",
  "protocol": "oauth2",
  "template": "github",
  "display_name": "GitHub",
  "subject_claim": "id",
  "claim_mapping": {
    "email": "email",
    "givenName": "name"
  },
  "verified_claims": {
    "email": "$supplementary_fetch"
  },
  "provisioning": {
    "is_creation_allowed": true,
    "is_auto_creation": false
  },
  "oauth2": {
    "authorization_endpoint": "https://github.com/login/oauth/authorize",
    "token_endpoint": "https://github.com/login/oauth/access_token",
    "userinfo_endpoint": "https://api.github.com/user",
    "client_id": "Iv1.abc123",
    "client_secret_env": "GITHUB_CLIENT_SECRET",
    "token_endpoint_auth_method": "client_secret_post",
    "scopes": [
      "read:user",
      "user:email"
    ],
    "supplementary_fetch": "github_primary_email"
  }
}
```

</details>

Key observations from these example connection configurations:
- **Endpoint Resolution:** Google uses OIDC discovery (requiring only the issuer), 
though explicit overrides like `jwks_uri` are supported for providers without a `.well-known` document. 
GitHub uses OAuth2, which lacks discovery, requiring all three endpoints to be explicit.
- **Secret Management:** Configurations store env var references (e.g., `GOOGLE_CLIENT_SECRET`), not values. 
Values live in `.env.local` during dev. How production environments resolve their values is the undesigned secret lifecycle;
see [Secrets and environments](#secrets-and-environments).
- **Schema-Driven Mapping:** `claim_mapping` generates dynamically from the active user schema. 
Nothing is assumed to exist (including `email`), and to prevent validation errors, 
the generator only maps defined properties.
- **Verification Sources:** `verified_claims` defines the source of truth. 
Google uses an explicit claim (`email_verified`), whereas GitHub defers to the strategy execution by mapping 
`"email": "$supplementary_fetch"`.
- **Editor Tooling:** `$schema` just points to `.zitadel/meta/` for IDE autocomplete; the platform ignores it.

Tracking is handled by `state.json`, which uses `id`, `hash`, and `previousId`, 
with `scaffoldedFrom` proposed as an addition; see [Open points](#open-points).

## The connection schema

<details open>
<summary><code>idp-connection.json</code> - the full schema</summary>

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "IdentityProviderConnection",
  "type": "object",
  "required": [
    "slug",
    "protocol",
    "display_name"
  ],
  "additionalProperties": false,
  "properties": {
    "$schema": {
      "type": "string",
      "description": "Editor affordance: path or URL of this schema so editors validate and autocomplete the file (scaffolded connection files point at `.zitadel/meta/idp-connection.json`). Ignored by the platform."
    },
    "slug": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9_-]*$",
      "maxLength": 64,
      "description": "Stable identifier, referenced by user schemas (x-auth-methods.sso.providers) and flow steps (sso_providers[].id). Unique within the Project.",
      "examples": [
        "google",
        "github",
        "corp_idp"
      ]
    },
    "protocol": {
      "type": "string",
      "enum": [
        "oidc",
        "oauth2"
      ],
      "description": "Selects which protocol block is required and which engine handles the connection. Closed: every value has a server implementation."
    },
    "template": {
      "type": "string",
      "examples": [
        "google",
        "github",
        "okta"
      ],
      "description": "Rendering hint (logo, brand colors) consumed by the login template, not by the engine."
    },
    "display_name": {
      "type": "string",
      "maxLength": 256,
      "description": "Shown to the user on the sign-in button."
    },
    "subject_claim": {
      "type": "string",
      "description": "Claim carrying the provider's stable subject identifier. Optional for OIDC (the engine uses `sub` per spec; override where `sub` is pairwise, e.g. Entra `oid`). Required for OAuth2 \u2014 no `sub` guarantee."
    },
    "claim_mapping": {
      "type": "object",
      "additionalProperties": {
        "type": "string"
      },
      "description": "Maps user-schema property names (keys) to provider claim names (values). May name properties only some schemas define; unmatched entries are ignored per schema."
    },
    "verified_claims": {
      "type": "object",
      "additionalProperties": {
        "anyOf": [
          {
            "const": true
          },
          {
            "const": "$supplementary_fetch"
          },
          {
            "type": "string",
            "pattern": "^[^$]"
          }
        ]
      },
      "description": "Maps a verifiable user-schema property to its verification source: a claim name (read the claim), the literal `true` (trust this provider unconditionally), or `\"$strategy\"` (verified by the selected supplementary_fetch strategy per its contract - e.g. github_primary_email verifies `email` via primary && verified). Values starting with `$` are reserved; only `$supplementary_fetch` is defined. Distinct from claim_mapping, which carries values, not verification state.",
      "examples": [
        {
          "email": "email_verified"
        },
        {
          "email": true
        },
        {
          "email": "$supplementary_fetch"
        }
      ]
    },
    "provisioning": {
      "type": "object",
      "additionalProperties": false,
      "description": "What Zitadel may do with the resulting identity. `is_creation_allowed` permits creating a user from this provider at all; `is_auto_creation` decides whether creation happens automatically when the provider's claims satisfy every required property (verified, for properties carrying `x-verify`), or the flow stops to collect. Linking policy (`is_linking_allowed`, `auto_linking`) returns with the deferred account-linking journey - additive.",
      "properties": {
        "is_creation_allowed": {
          "type": "boolean",
          "default": true
        },
        "is_auto_creation": {
          "type": "boolean",
          "default": false
        },
        "is_auto_update": {
          "type": "boolean",
          "default": false
        }
      }
    },
    "oidc": {
      "type": "object",
      "additionalProperties": false,
      "description": "OIDC connection details. Endpoints come from discovery, but any may be supplied to override it, or to serve a provider that exposes no .well-known document.",
      "required": [
        "issuer",
        "client_id",
        "client_secret_env",
        "scopes"
      ],
      "properties": {
        "issuer": {
          "type": "string",
          "format": "uri",
          "pattern": "^https://|^http://(localhost|127\\.0\\.0\\.1)([:/]|$)",
          "description": "Discovery base. Endpoints are resolved from its .well-known document unless overridden below."
        },
        "jwks_uri": {
          "type": "string",
          "format": "uri",
          "pattern": "^https://|^http://(localhost|127\\.0\\.0\\.1)([:/]|$)",
          "description": "Overrides the JWKS endpoint from discovery. Required in practice when the provider exposes no .well-known document, since ID tokens cannot otherwise be validated."
        },
        "id_token_mapping": {
          "type": "boolean",
          "default": false,
          "description": "Read user claims from the id_token instead of the userinfo endpoint, for providers that populate only the former."
        },
        "authorization_endpoint": {
          "type": "string",
          "format": "uri",
          "pattern": "^https://|^http://(localhost|127\\.0\\.0\\.1)([:/]|$)",
          "description": "Overrides discovery."
        },
        "token_endpoint": {
          "type": "string",
          "format": "uri",
          "pattern": "^https://|^http://(localhost|127\\.0\\.0\\.1)([:/]|$)",
          "description": "Overrides discovery."
        },
        "userinfo_endpoint": {
          "type": "string",
          "format": "uri",
          "pattern": "^https://|^http://(localhost|127\\.0\\.0\\.1)([:/]|$)",
          "description": "Overrides discovery."
        },
        "client_id": {
          "type": "string",
          "maxLength": 512
        },
        "client_secret_env": {
          "type": "string",
          "pattern": "^[A-Za-z_][A-Za-z0-9_]*$",
          "description": "Name of the environment variable holding the client secret. The value itself never appears in configuration."
        },
        "token_endpoint_auth_method": {
          "type": "string",
          "enum": [
            "client_secret_basic",
            "client_secret_post"
          ],
          "default": "client_secret_basic",
          "description": "How the client authenticates at the token endpoint. Providers genuinely differ; closed because each value is an engine behaviour."
        },
        "scopes": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true,
          "minItems": 1,
          "contains": {
            "const": "openid"
          },
          "default": [
            "openid",
            "profile",
            "email"
          ],
          "description": "Must contain `openid` - without it the provider returns no id_token and the connection is not OIDC. Enforced by `required` + `contains`; the `default` is a UI-prefill hint only - validators never inject it, so an omitted `scopes` is rejected regardless."
        },
        "pkce_enabled": {
          "type": "boolean",
          "default": true,
          "description": "Send PKCE (code_challenge/code_verifier). Providers that do not support PKCE typically ignore the parameters, so `true` is safe and future-proofs; set `false` only for a provider whose token endpoint rejects them. Per-provider behaviour is part of the pin-verification before defaults ship."
        },
        "static_authorize_parameters": {
          "type": "object",
          "propertyNames": {
            "not": {
              "enum": [
                "client_id",
                "redirect_uri",
                "response_type",
                "scope",
                "state",
                "nonce",
                "code_challenge",
                "code_challenge_method"
              ]
            }
          },
          "additionalProperties": {
            "type": "string"
          },
          "description": "Extra provider-specific authorize parameters (for example `prompt`). Engine-owned protocol parameters are reserved and rejected by `propertyNames`: the engine composes them itself, and an override of `state` or `nonce` would silently defeat CSRF and token binding."
        }
      }
    },
    "oauth2": {
      "type": "object",
      "additionalProperties": false,
      "description": "OAuth 2.0 connection details. No discovery exists, so all three endpoints are stated explicitly.",
      "required": [
        "authorization_endpoint",
        "token_endpoint",
        "userinfo_endpoint",
        "client_id",
        "client_secret_env"
      ],
      "properties": {
        "authorization_endpoint": {
          "type": "string",
          "format": "uri",
          "pattern": "^https://|^http://(localhost|127\\.0\\.0\\.1)([:/]|$)",
          "description": "Where the user is sent to authorize."
        },
        "token_endpoint": {
          "type": "string",
          "format": "uri",
          "pattern": "^https://|^http://(localhost|127\\.0\\.0\\.1)([:/]|$)",
          "description": "Where the authorization code is exchanged."
        },
        "userinfo_endpoint": {
          "type": "string",
          "format": "uri",
          "pattern": "^https://|^http://(localhost|127\\.0\\.0\\.1)([:/]|$)",
          "description": "Where the authenticated user's profile is fetched."
        },
        "client_id": {
          "type": "string",
          "maxLength": 512
        },
        "client_secret_env": {
          "type": "string",
          "pattern": "^[A-Za-z_][A-Za-z0-9_]*$",
          "description": "Name of the environment variable holding the client secret. The value itself never appears in configuration."
        },
        "token_endpoint_auth_method": {
          "type": "string",
          "enum": [
            "client_secret_basic",
            "client_secret_post"
          ],
          "default": "client_secret_basic",
          "description": "How the client authenticates at the token endpoint. Providers genuinely differ; closed because each value is an engine behaviour."
        },
        "scopes": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true,
          "description": "Provider-specific; OAuth 2.0 defines no universal scope."
        },
        "pkce_enabled": {
          "type": "boolean",
          "default": true,
          "description": "Send PKCE (code_challenge/code_verifier). Providers that do not support PKCE typically ignore the parameters, so `true` is safe and future-proofs; set `false` only for a provider whose token endpoint rejects them. Per-provider behaviour is part of the pin-verification before defaults ship."
        },
        "static_authorize_parameters": {
          "type": "object",
          "propertyNames": {
            "not": {
              "enum": [
                "client_id",
                "redirect_uri",
                "response_type",
                "scope",
                "state",
                "nonce",
                "code_challenge",
                "code_challenge_method"
              ]
            }
          },
          "additionalProperties": {
            "type": "string"
          },
          "description": "Extra provider-specific authorize parameters (for example `prompt`). Engine-owned protocol parameters are reserved and rejected by `propertyNames`: the engine composes them itself, and an override of `state` or `nonce` would silently defeat CSRF and token binding."
        },
        "supplementary_fetch": {
          "type": "string",
          "enum": [
            "github_primary_email"
          ],
          "description": "Provider-specific follow-up call after userinfo, implemented in the engine. Closed: every value is implemented behaviour. New values are non-breaking."
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "supplementary_fetch": {
                "const": "github_primary_email"
              }
            },
            "required": [
              "supplementary_fetch"
            ]
          },
          "then": {
            "required": [
              "scopes"
            ],
            "properties": {
              "scopes": {
                "contains": {
                  "const": "user:email"
                }
              }
            }
          }
        }
      ]
    }
  },
  "allOf": [
    {
      "if": {
        "properties": {
          "protocol": {
            "const": "oidc"
          }
        },
        "required": [
          "protocol"
        ]
      },
      "then": {
        "required": [
          "oidc"
        ],
        "properties": {
          "oauth2": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "protocol": {
            "const": "oauth2"
          }
        },
        "required": [
          "protocol"
        ]
      },
      "then": {
        "required": [
          "oauth2",
          "subject_claim"
        ],
        "properties": {
          "oidc": false
        }
      }
    }
  ]
}
```

</details>

How to read the schema:

- **Root vs. Protocol Blocks:** The root level defines universal requirements: identity (`slug`, `protocol`, `template`, `display_name`), resolution (`subject_claim`, `claim_mapping`, `verified_claims`), and policy (`provisioning`). Protocol-specific plumbing is isolated inside nested blocks.
- **Protocol Selection:** The `protocol` field dictates the active block. Using `if protocol == "oidc"` requires the `oidc` block and explicitly forbids `oauth2`. Adding future protocols is a mechanical backend process that tenant files never see.
- **Precise Error Messages:** The schema uses `if`/`then` conditionals rather than `oneOf`. While `oneOf` throws generic "all arms failed" errors, `if`/`then` pinpoints the exact issue (e.g., `/oidc must have required property 'client_id'`).
- **Intentional Duplication:** The two protocol blocks duplicate ten shared fields. Factoring them out would require `unevaluatedProperties`, which many third-party validators do not support. Since a connection file only ever contains one block, this duplication is safer and more compatible.
- **Scope Enforcement:** In the OIDC block, `scopes` must contain `openid` (enforced via `required` and `contains`, as JSON Schema `default` values do not inject data). Without `openid`, it is not a valid OIDC connection.
- **Subject Claims:** The `subject_claim` field is optional for OIDC (the spec guarantees `sub`, though overrides exist for pairwise IDs like Entra) but strictly required for OAuth2.
- **Strict Secrets:** Literal secrets cannot be committed. Because the schema objects are strict and no `client_secret` property exists, pasting a raw secret triggers an immediate validation error.
- **Editor and UI Affordances:** The `format: "uri"` rule is just an annotation for editor linting (per Draft 2020-12), and `template` is simply a UI rendering hint (for logos and brand colors). Neither reaches the core engine.
- **TLS Required:** Every endpoint URL (`issuer`, `jwks_uri`, and the endpoints in both blocks) carries a `pattern` requiring `https://`, with one carve-out for local development (`http://localhost` and `http://127.0.0.1`). OIDC requires TLS on these endpoints, and every one of them handles codes, tokens, or key material; `format: "uri"` alone would enforce nothing. The carve-out is exactly those two spellings; `http://[::1]` does not match, so IPv6 loopback setups must use `localhost`.
- **Future-Proof Terminology:** "Claim" is used as a protocol-neutral term for any provider assertion (whether OIDC claims, OAuth2 userinfo, or future SAML attributes), ensuring root field names remain stable as new protocols are added.

### Provisioning

The provisioning policy is controlled by three flags, all retaining their Epic 851 behaviors. 
These flags directly transcribe the legacy provider options ([`oidc/oidc.go#L41-L60`](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/oidc/oidc.go#L41-L60) `WithCreationAllowed` / `WithAutoCreation` / `WithAutoUpdate`):

| Flag | Behavior / Question it answers |
| :--- | :--- |
| `is_creation_allowed` | Can this provider create new users at all? |
| `is_auto_creation` | Should users be created silently if claims cover all required properties (and verified where `x-verify` is present), or should the flow stop to collect missing data? |
| `is_auto_update` | Should the system refresh stored user attributes during subsequent sign-ins? |

By default, 851 scaffolds `is_auto_creation: false` to ensure users manually review and complete their data. The complete logic for this is detailed under the [resolution branches](3-social-login-flow.md#resolution-branches) in Area 3.

*Note:* The legacy flags that governed account linking (`is_linking_allowed`, `auto_linking`) have been removed from this initial release. See [Linking safety](#linking-safety) for details.

### Deferred and Cut Fields

Several fields have been intentionally excluded from the initial schema based on a strict rule: **nothing is selectable without a backing implementation**. When these features are eventually built, they will be reintroduced as additive, non-breaking changes.

| Deferred Field | Return Condition / Status                                                                                                                                                                                                                                       |
| :--- |:----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `secret_strategy` & `secret_params` | When Apple integration is scoped (required for Apple's signed secret).                                                                                                                                                                                          |
| `response_mode` (`form_post`) | When Apple is scoped (the current 851 callback supports GET only).                                                                                                                                                                                              |
| `dynamic_authorize_parameters` | Once a design exists for sourcing runtime values in the authorize URL.                                                                                                                                                                                          |
| `is_linking_allowed`, `auto_linking` | When the deferred account-linking journey is designed and implemented.                                                                                                                                                                              |
| `enabled` | **Not planned.** An unlisted connection is already inert. Furthermore, a config flag is a poor mechanism for an emergency disable (due to release latency, and rollbacks would inadvertently re-enable it). Imperative runtime disabling remains an open point. |
| `kind`, `audience`, `default_schema` | **Cut completely.** No identified use case or need.                                                                                                                                                                                                             |

- **No `audience`:** Unlike flows, which the engine dynamically selects via audience matching (e.g., app-level overrides project-level), connections are never dynamically selected. Instead, they are explicitly referenced by `slug` and gated by a schema's provider list. Scoping already cascades cleanly: schemas define allowable providers, flows offer a subset of those providers, and flows are selected per app. Adding an `audience` field to the connection would just introduce a second, conflicting scoping axis.
- **No `default_schema`:** Users always arrive through a specific flow, and it is the flow that pins the active `user_schema`. Because a single IdP connection is explicitly designed to serve multiple schemas, hardcoding a default schema on the connection itself is unnecessary.

## Claim Mapping

The `claim_mapping` block translates the tenant's internal property names (keys) into the external provider's claim names (values):

```jsonc
"claim_mapping": { "email": "email", "givenName": "name", "employeeId": "login" }
```

- **Multi-Schema Support:** A single connection can serve multiple schemas. Each schema simply filters the mapping, consuming only the properties it defines and safely ignoring the rest.
- **Clean Scaffolding:** The generator only emits mapping targets relevant to the selected use case, ensuring scaffolded files never start with unknown targets.
- **Known Limitation:** If two schemas use the exact same property name but need it populated from different provider claims, they cannot share a connection. The workaround is to create a second connection with a distinct `slug`.
- **No Annotation Conflicts:** The currently unused `x-claim` annotation on user properties dictates what claim Zitadel emits, meaning it does not conflict with this incoming connection mapping.
- **Catalog Data Caveat:** GitHub exposes no given/family name split; its `name` claim is the full display name. The catalog recipe still maps `givenName: "name"` as the pragmatic default, which puts a full name into `givenName`. Tenants wanting precise name semantics drop that mapping and let the collection step ask. `familyName` has no GitHub source and is never mapped.
- **Validation vs. Runtime Safety:** Unknown-target checks run primarily during the plan phase. The CLI can validate mappings against every referencing schema (i.e., schemas listing the connection's slug in x-auth-methods.sso.providers) because it reads the entire working tree. The server cannot easily do this because schema revisions lack a stable lineage identity. Instead, the server enforces consistency during flow creation and updates. At runtime, the active schema revision pinned by the flow strictly filters the mapping, and any unmatched keys, whether accidental typos or intentional superset configurations, are safely ignored.

The `verified_claims` field is the companion map for verification state, offering three value forms:

| Value | Meaning | Exists because |
| :--- | :--- | :--- |
| `"email_verified"` | Read this claim. | OIDC providers assert verification in a specific claim. |
| `true` | Trust this provider unconditionally. | Entra-style stated trust requires it. |
| `"$supplementary_fetch"` | The selected fetch strategy verifies it. | GitHub verification relies on a `primary && verified` fetch result, not a single claim. |

A `$`-prefixed value acts as a pointer to the strategy field of the same name 
in the protocol block. For instance, `"$supplementary_fetch"` defers to whatever 
the `supplementary_fetch` field selects. The strategy's backend contract (its server-side definition) must formally declare that it knows how to verify that specific property. If you write a pointer without selecting a strategy, or map it to a property the strategy cannot verify, you will get a validator error.

All `$`-values are reserved. Currently, only `$supplementary_fetch` exists, making any other `$`-string an automatic validation error. This prefix is exactly what makes strict validation possible. Because standard claim names are provider-controlled and unverifiable during the plan phase, a typo in a plain value would silently fail to verify, but a typo in a `$`-value triggers a hard schema error. This prefix also keeps the pointer out of the standard claim-name namespace, following the `$schema` and `$ref` convention of marking values that the machinery itself interprets. One adjacent slip stays out of its reach: the string `"true"` is a claim name, not the boolean `true`, so it sends the engine looking for a claim literally named `true` and lands fail-closed. The validator should warn on the literal strings `"true"` and `"false"` here, in the warning tier of the rules below.

The list of allowable pointers will grow only when a new claim-verifying strategy *slot* is added, requiring just one `const` per slot, making it a non-breaking change. Introducing new strategies to an existing slot requires no schema changes, because the pointer references the field name, not the specific strategy.

## Linking Safety

Epic 851 does not include account linking. The linking fields are excluded from the schema, and the engine currently has no linking path. This section records the analysis that future linking implementations must inherit to avoid security flaws:

- **Email linking requires verified claims:** Auto-linking accounts based on unverified emails is an account takeover risk. OAuth2 `userinfo` lacks verification semantics, and some OIDC providers allow tenant admins to set arbitrary emails (such as the nOAuth attack against Entra). Therefore, auto-linking by email must strictly require verified-email coverage.
- **Linking rules are cross-resource:** Tenants author their own property names. Which property acts as "the email" is defined by the referencing schemas' annotations, not by the connection. This means the linking rule belongs in the validator and the engine, rather than the connection schema. Hardcoding a check for the literal name `email` in the connection schema would break for any tenant who names their property `emailAddress`.
- **Username matching limitations:** Username matching has no verification equivalent. Subject-based matching is the only strongly secure variant.
- **Subject matching is not schema-aware:** A single connection can serve several schemas, so one person's Google account can legitimately back both a Customers user and an Employees user. The link key `(connection, subject)` carries no schema, a user row carries exactly one (`users.schema_url`, `internal/storage/dialect/postgres/migration/sql/000004_users.sql:5`), and a flow definition names exactly one (`user_schema`, `api/openapi/components/flows/flow-definition.yaml:26`). A subject lookup can therefore return a record the active flow's schema does not own. Linking must settle whether identity spaces are per schema or per project before it can match on subject at all; the open question lives in [area 3](3-social-login-flow.md#open-points).

The `verified_claims` field itself remains in 851 because the user creation and `is_auto_update` processes consume it.

**The `x-verify` Dependency:**
`x-verify` no longer exists in the dialect. [#901](https://github.com/zitadel/nextgen/pull/901) removed it (together with `x-editable`, `x-sensitive`, and `x-mfa`) because nothing read it, stating the removed annotations "can be re-added once they become required". [`user-property.json`](../../../packages/config/meta-schemas/user-property.json) today carries only `x-unique`, `x-claim`, and `x-audit`. This design is the first consumer: every `x-verify` reference in these documents describes the returning annotation, not the shipped dialect.

The annotation returns with the engine work that first reads it, the way `x-audit` returned with its emitter (#808). The step 5 gate evaluation ([area 3](3-social-login-flow.md#callback-processing)) needs only the annotation and the attempt. Recording the result at creation, the `is_auto_update` downgrade guard, and dropping verification on edit also need per-property state tracking, which does not exist either (`user_attributes` stores bare key/value pairs; listed as engine work in [area 3](3-social-login-flow.md#engine-work)). On return, the free-form `string` value should tighten to an enum of implemented methods, per the same nothing-without-implementation rule that governs [deferred and cut fields](#deferred-and-cut-fields). The two validator rules below that pair `verified_claims` with `x-verify` activate when it returns. Until that per-property state exists, the engine treats `is_auto_update` as `false` (fail closed), whatever the connection sets.


## Validator Rules

These are cross-file and state-dependent rules that a single-file JSON schema cannot express. They are implemented in two places: the TypeScript CLI validator (which reads the working tree and CLI state during the validation phase) and the Go server (which mirrors the rules where it has the inputs; its schema-connection share is enforced when flows are created or updated, as detailed in the [validation rules](2-auth-method-selection.md#validation-rules)). The checks comparing `claim_mapping` and `verified_claims` against schemas are provisional (see [Open points](#open-points)).

| Rule / Constraint | Severity | Description                                                                                                                                                                                                             |
| :--- | :--- |:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Slug Uniqueness** | Error | `slug` must be unique across all `.zitadel/idps/` files.                                                                                                                                                                |
| **Slug Modification** | Error | Cannot change the `slug` on a state-tracked file. A true rename requires creating a new one (see [Lifecycle](#connection-lifecycle)).                                                                                              |
| **File Move** | *Handled* | An orphaned state entry paired with a new file using the same `slug` is treated as a file move. State is rekeyed, and the platform is not touched.                                                                      |
| **Orphaned Mapping Target** | Error | A `claim_mapping` target is unknown to *every* referencing schema (assumes at least one schema references the connection). This typically indicates a typo.                                                             |
| **Missing Mapping Target** | Warning | A `claim_mapping` target is missing from *some* referencing schemas. This is permitted because a connection can legitimately map a superset of fields.                                                                  |
| **Orphaned Verification Key** | Error | A `verified_claims` key is unknown to *every* referencing schema. A typo here means the claim will silently never verify.                                                                                               |
| **Unreferenced Typo Guard** | Warning | The connection is not referenced by any schema, and a mapping target or verification key is unknown to *every* schema in the working tree.                                                                              |
| **Missing `x-verify` Method** | Warning | A `verified_claims` key points to a property that lacks an `x-verify` method (verification with nowhere to land). Activates when `x-verify` returns (see the dependency note under [Linking Safety](#linking-safety)).                                                                                                       |
| **Invalid Strategy Pointer** | Error | `"$supplementary_fetch"` is used without selecting a strategy, or the selected strategy's contract does not verify that specific property.                                                                              |
| **Inert Connection** | Warning | The connection is referenced by zero schemas. No flow can offer it, making it completely inert.                                                                                                                         |
| **Impossible Registration** | Warning | A flow registration step offers this provider, but `is_creation_allowed` is `false`. The user will never be able to successfully sign up.                                                                               |
| **Impossible Auto-Creation (Data)** | Warning | `is_auto_creation` is `true`, but a referencing schema requires a property that the `claim_mapping` does not target. Every sign-in will stop to collect the missing data.                                               |
| **Impossible Auto-Creation (Verification)**| Warning | `is_auto_creation` is `true`, but a referencing schema requires an `x-verify` property that lacks a `verified_claims` entry. Absent entries evaluate as unverified, meaning the auto-creation condition can never pass. Activates when `x-verify` returns. |
| **Missing Env Vars** | Error / Warning | Referenced environment variables are missing from the local environment. Interactive journeys and test preflight raise `E_CREDENTIAL_MISSING` as an error (the developer is present to fix it). Batch `plan` only warns, so one IdP file cannot force secrets into every CI pipeline; the authoritative presence check is the server's, at deploy time (see [Upstream Security Pushback](#upstream-security-pushback)). Shipped `assertEnvRefs` hard-fails `plan` for schemas and flows today, so the batch relaxation is a deliberate change. |
| **Literal Secret** | Error | A hardcoded `client_secret` is present (returns a friendly error message, though the schema strictly rejects it anyway).                                                                                                |
| **Leaked Secret** | Warning | A secret-shaped key is found inside `static_authorize_parameters`. This value would be committed to source control and appended to the public authorize URL. Warning, not Error, because the detection is heuristic; the definite cases already error (`client_secret` via Literal Secret, engine-owned keys via Reserved Authorize Parameter). |
| **Reserved Authorize Parameter** | Error | A `static_authorize_parameters` key names an engine-owned protocol parameter (`client_id`, `redirect_uri`, `response_type`, `scope`, `state`, `nonce`, `code_challenge`, `code_challenge_method`). The engine composes these itself; a config override of `state` or `nonce` would silently defeat CSRF and token binding. The schema's `propertyNames` already rejects the keys; this rule restates the failure with a friendly message (like Literal Secret). |
| **Cleartext Endpoint** | Error | An endpoint URL (`issuer`, `jwks_uri`, `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`) is not `https://`. The schema `pattern` already rejects it, with a `http://localhost` / `http://127.0.0.1` carve-out for local development; this rule restates the failure with a friendly message. |

**The Unreferenced-Connection Guard:** This specific guard is crucial for the scaffolding experience. A freshly scaffolded connection starts with zero referencing schemas. Without this rule, every default mapping target would immediately trigger an "unknown target" error. Instead, the validator allows superset keys to exist, but will throw a warning on the initial validation run if a key is completely unknown to *every* schema in the entire working tree. This catches obvious typos early, and the stricter error rules take over as soon as a schema actually references the connection.

## Immutability and Revisions

Editing a connection publishes a new, immutable revision rather than modifying it in place. The previous revision continues to exist. This design serves three critical purposes:

- **Stable Auth Attempts:** An SSO attempt spans an external redirect. Configuration is read when building the authorize URL and again minutes later during the code exchange. To prevent mid-flight changes, an attempt binds to a specific revision when it starts and finishes on that exact same revision.
- **Reliable Rollbacks:** A release inherently pins a specific revision of every resource (per ADR 035). If connections were mutable, there would be no static state to pin for a rollback.
- **Built-in Auditing:** Immutable revisions provide a free audit trail (e.g., tracking exactly who changed a client ID, and when).

*Note:* Rotating a secret does not create a new revision because the configuration file only stores the environment variable name, not the secret's value. (Flow definitions are transitioning to this same revisioned model in [#530](https://github.com/zitadel/nextgen/issues/530)).

## Referencing by Slug

Upstream resources, such as schemas (`x-auth-methods.sso.providers`) and flow steps (`sso_providers[].id`), always reference connections by their `slug` (e.g., `google`), never by their revision ID.

- **Avoiding Cascading Updates:** If references relied on revision IDs, a single connection edit would trigger a cascade. A new connection revision means a new ID; every referencing schema would have to be updated (publishing new schema revisions), which would in turn force every flow pinning those schemas to re-pin. By referencing the `slug`, nothing upstream needs to move.
- **Restoring Determinism:** The trade-off of referencing a slug is late binding (the name `google` does not explicitly state which revision should run). To maintain strict determinism, two exported mechanisms handle resolution:
  1. The auth attempt binds the current revision at the exact moment it starts.
  2. The release bundle securely records which revision each slug resolved to at the time of construction.

## Connection Lifecycle

- **Slugs cannot be renamed in place:** Any runtime binding to the old name (such as in-flight attempts, deployed releases, or identity links) would break without a migration path. Therefore, the validator strictly refuses in-place slug edits. The correct migration path is to create a new connection with the new slug, update all upstream references, and safely retire the old connection on its own schedule.
- **Renaming a file is treated as a move:** Because state is keyed by file path, a standard `git mv` normally looks like a deletion at the old path and a creation at the new one, which would trigger a real platform delete. To prevent this, the planner intelligently pairs an orphaned state entry with the new file carrying the identical slug. It then rekeys the state without touching the platform. Since slugs are unique, this pairing is completely unambiguous. (Note: Renaming the file *and* changing the slug simultaneously is treated as a genuine delete and create).
- **Deletion semantics are undecided:** Active deployments might pin a specific revision, and an in-flight attempt might rely on a revision that no current release pins. A "refuse-while-pinned" approach would require a grace window, whereas "tombstoning" avoids both issues. What is certain is that a connection requires a true end-of-life process. Inheriting the `SchemaSyncer`'s "not-implemented" error is unacceptable, so the exact mechanism must be finalized with the CRUD API. Settled: tombstoning, in [`9-crud-api.md`](9-crud-api.md#deletion-and-slug-reservation).
- **Identity links require a stable key:** Users created via an external provider hold identity links keyed to that connection, but no revision-stable key currently exists. Revision IDs change on every edit, which would orphan existing links. Conversely, slugs can be reused after a delete and create cycle. If a new connection reuses a retired slug but points to a different issuer, it would automatically inherit the old user links, creating a severe account-takeover risk. To resolve this, the CRUD API must either mint a permanent lineage ID that survives revisions or strictly enforce slug reservation upon deletion. Settled: the lineage row provides both at once ([`9-crud-api.md`](9-crud-api.md#resource-identity-model)).

## Secrets and Environments

**What is currently implemented:** The file convention. Files store variable names (e.g., `client_secret_env`), and literal secrets fail validation. Scaffolding automatically gitignores `.env*` files, error messages only expose variable names, and file bodies are uploaded verbatim.

**What is missing:** Everything after the file upload. There is currently no secret store, resolution step, or rotation path designed. The nearest specification, [`configuration-surface.md`](../platform/configuration-surface.md), explicitly defers the secret-store design.

This document outlines the strict constraints that any future secret lifecycle design must satisfy:

| Ruled Out Approach | Reason |
| :--- | :--- |
| **Client-side resolution** (uploading the resolved value in the document) | Every immutable revision would permanently embed the secret. Leaks could never be scrubbed, rollbacks would reactivate revoked secrets, and plan diffs would expose secret material in Git and CI logs. |
| **Server-side OS resolution** (server reads from its own environment) | This only works for self-hosted setups. In a multi-tenant system, operators would be forced to inject every tenant's secrets into the core engine configuration. |

**The Surviving Pattern:** The configuration file stores the variable name, the value is delivered out of band, and the engine joins them at runtime. This allows secrets to be rotated via a store write without publishing a new config revision, and it keeps values safely outside the release boundary. The store and its API are undesigned, so this stays an open question, not a decision.

**Strict Invariant:** Secret resolution must never happen upstream of anything that is diffed, hashed, committed, or printed.

### Open Challenges

- **Rotation:** Rotation is a critical emergency path. Because the engine currently hashes the file to detect changes, a "rotate-then-apply" action would silently skip execution ("no change") during an incident. The final design needs a mechanism to positively confirm that the engine holds the new secret value.
- **Per-environment non-secrets:** Values like `client_id` differ between environments (e.g., dev vs. prod). While `${VAR}` syntax exists, resolution does not. Because a release deploys the exact same file revision to every environment, these variables cannot be resolved directly into the file. The reference must reach the engine and resolve against the environment there. To support single-environment projects natively, the configuration field accepts either a literal string or `${VAR}` syntax without requiring a separate `client_id_env` field.

### Upstream Security Pushback

Before the deferred secret-store specification is finalized, the following architectural constraints must be addressed:

- **Write-only production stores:** The proposed "read-back" store (where teammates can fetch per-environment secrets) is an anti-pattern. A read-back model means one compromised project credential exposes every provider secret across all environments. Production values must be writable by the deployment identity, readable exclusively by the engine, and never fetchable by local developer setups.
- **Scoping the presence check:** Requiring secret validation before a plan runs means a single IdP file in the repository will force every CI pipeline to demand secrets, even for unrelated PRs. The plan phase should only issue warnings. Strict presence checks should be answered by the server during actual create or update deployments. The validator rules adopt this split: `E_CREDENTIAL_MISSING` stays an error inside interactive journeys and test preflight, batch `plan` warns, and the server answers the strict check at deploy.
- **Encryption minimums:** Stating "encrypted at rest" is insufficient. The architecture must guarantee per-tenant envelope keys, engine-only decryption, and a strictly write-only external API surface.

## Forward Compatibility

Connection files are committed to version control and entirely tenant-owned. Therefore, any schema change that invalidates existing files is treated as a required migration, not just a standard release.

| Change Type | Breaking? |
| :--- | :--- |
| Adding an optional property, a new enum value, a new protocol block, or relaxing a requirement. | No |
| Adding a required property, tightening a constraint, or adding new requirements to an existing enum value. | **Yes** |

The risk of breaking changes is exactly why unimplemented values are excluded from the initial schema. Shipping a placeholder now and attaching requirements to it later would instantly break existing tenant configurations. To verify this intended extension path, the testing "receipt suite" proves that a future schema (one incorporating Apple-specific fields like `secret_strategy`, `secret_params`, and `response_mode`) will seamlessly validate every file that passes today.

**Reverse Compatibility:** The reverse direction is intentionally not protected. An older version of the validator will actively reject a newer file containing unknown fields. This is the accepted trade-off required to maintain strict and effective typo-catching.

## Exported Requirements

Behaviors this design relies on but does not implement. Each later area opens with a checklist saying which of these it answers.

| Requirement | Owed By |
| :--- | :--- |
| An SSO attempt must bind to a specific connection revision at the exact moment it starts. | [`3-social-login-flow.md`](3-social-login-flow.md) |
| An absent verification claim must be evaluated as unverified (fail closed). | [`3-social-login-flow.md`](3-social-login-flow.md) / Engine ([`8-protocol-client.md`](8-protocol-client.md)) |
| Truthiness evaluation must strictly accept only boolean `true` or string `"true"`. | [`3-social-login-flow.md`](3-social-login-flow.md) / Engine ([`8-protocol-client.md`](8-protocol-client.md)) |
| `is_auto_update` must never silently overwrite a verified property with an unverified value. | [`3-social-login-flow.md`](3-social-login-flow.md) / Engine |
| Strict linking coverage rules must be enforced when the feature returns. | Deferred account-linking journey |
| Slug-to-revision resolution must be securely recorded during release-bundle construction. | [#529](https://github.com/zitadel/nextgen/issues/529) bundle constructor |
| The API surface must support `get-by-slug` and strictly enforce uniqueness on creation. | Server CRUD API ([`9-crud-api.md`](9-crud-api.md)) |
| A revision-stable lineage identity must be established to safely maintain user identity links. | Server CRUD API + Deletion semantics ([`9-crud-api.md`](9-crud-api.md)) |
| A resolved client-secret value must be obtainable during the token exchange step. | Deferred secret-store spec (production); the development-runtime env join is [#851](https://github.com/zitadel/nextgen/issues/851) execution work (see [Open Points](#open-points)) |
| The server must validate every connection body against `idp-connection.json` at create and revise, before a revision is stored. Client-side validation does not cover hand-authored API writes (ADR 035 keeps direct CRUD first-class), and revisions are immutable, so a stored literal secret could never be scrubbed. | Server CRUD API ([`9-crud-api.md`](9-crud-api.md)) |
| The Go server must mirror and enforce all cross-resource validator rules. | Server validator (reads from [`9-crud-api.md`](9-crud-api.md)) |

## Open Points

- **`scaffoldedFrom` tracking:** We propose adding this optional string to `ResourceEntry` to record which shipped default originally generated a file. It acts as the merge base for upgrading scaffolded defaults later. It is cheap to record now but impossible to reconstruct later. The recommendation is to record it now and defer utilizing it until needed.
- **The secret lifecycle:** The actual mechanics of the secret lifecycle (the store, the set-surface, the engine join, and rotation) are owned by the deferred secret-store specification. This document only contributes the structural constraints and the security pushback outlined in the section above. That ownership covers production. Development cannot wait for the spec: the local runtime inherits only the CLI process environment ([`binary.ts:70`](../../../apps/cli/src/lib/local-server/binary.ts)) or two fixed docker `--env` values ([`docker.ts:35-38`](../../../apps/cli/src/lib/local-server/docker.ts)), so `.env.local` never reaches the engine and no configured provider can complete a token exchange. Wiring the development join is [#851](https://github.com/zitadel/nextgen/issues/851) execution work, under the same never-upstream invariant.
- **Imperative runtime disable:** We need a way to imperatively disable an IdP at runtime (e.g., `zitadel idp disable google --env prod`). This mechanism must be per-environment, execute in seconds, and remain immune to config rollbacks. Because of these requirements, it must be specified as part of the runtime surface, never as a configuration field.
- **Deletion semantics:** We must decide between a "refuse-while-pinned" approach (which requires a grace window for in-flight attempts) or a "tombstoning" approach. This will be settled alongside the design of the CRUD API. Settled as tombstoning in [`9-crud-api.md`](9-crud-api.md).
- **Schema-keyed validation:** It remains undecided how strictly connection fields keyed by user-schema properties (like `claim_mapping` and `verified_claims`) should be validated. The current "superset model" limits pair-wise checks to warnings, because a simple typo and a legitimate superset key are indistinguishable to the server (meaning the server never rejects mapping content). An alternative "1:1 rule" (where a connection slug belongs to at most one schema) would allow strict, error-grade checks, but forces tenants to create redundant connections. The current validator rules record the superset status quo until a final decision is made.
- **The CRUD API itself:** Currently, no IdP API exists. Building the endpoints, generated client, and handlers represents the largest pending work item in this domain. The surface is now designed in [`9-crud-api.md`](9-crud-api.md); implementation remains.

## Related

- [ADR 007](../../adrs/007-gitops-configuration-surface.md): GitOps configuration surface
- [ADR 035](../../adrs/035-configuration-environments.md): releases and environments
- [ADR 042](../../adrs/042-scaffolded-file-ownership-and-drift-detection.md): scaffolded app-file ownership; extended here by analogy
- [ADR 020](../../adrs/020-credentials-out-of-user-schema.md): `x-auth-methods` as policy input
- [`../cli/identity-surface.md`](../cli/identity-surface.md): earlier draft of this resource
- [`8-protocol-client.md`](8-protocol-client.md): area 8, the protocol client that answers the engine rows above
- [`9-crud-api.md`](9-crud-api.md): area 9, the CRUD surface that answers the server rows above
- [`../platform/configuration-surface.md`](../platform/configuration-surface.md): secrets, environments (written before ADR 035 renamed push to deploy)
- `api/openapi/endpoints/schemas/flow-definition.json`: `SSOProvider`, `Gate`
- `apps/cli/src/lib/sync/`: `ResourceSyncer`, state, sync loop
