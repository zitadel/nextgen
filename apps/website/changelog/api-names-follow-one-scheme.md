---
title: API operations follow one naming scheme
summary: 34 API operations are renamed to a verb and the resource they act on, the login flow API moves to /flows, and the events and branding lists page like every other list. Rename the calls in your code.
date: 2026-11-13T21:48Z
cloud: true
pulls: [3007, 3107, 3096, 3094, 3098, 3063, 3084]
---

Every API operation is now named with a camelCase verb and the resource it acts on, without a `ById` suffix, and every path parameter names its resource: `{schema_id}`, not `{id}`. URLs and requests don't change, but the names do in `@zitadel/api`, the Go client (`go.zitadel.com/zitadel/v5`), `zitadel api` and the API reference, whose old pages redirect. `zitadel api ls` lists the current names.

**Breaking:** 34 operations are renamed. Rename the calls in your code; among them:

- `GetUserByID`, `PatchUserByID` and `DeleteUserByID` are `getUser`, `updateUser` and `deleteUser`, and the other `…ById` reads drop the suffix.
- `getVariables`, `updateVariables` and `getDeploymentVariables` are `listVariables`, `setVariables` and `listDeploymentVariables`.
- `deleteTeam` is `deactivateTeam`; `patchMyUser` and `patchProject` are `updateMyUser` and `updateProject`.
- `addOrigin`, `removeOrigin`, `listPreviews` and `removePreview` are `addProjectOrigin`, `removeProjectOrigin`, `listProjectPreviews` and `removeProjectPreview`.
- The writes that publish a revision are `publishSchema`, `publishFlowDefinition`, `publishBranding`, `publishIdp` and `publishApplication`.

The [release notes](https://github.com/zitadel/nextgen/releases/tag/v0.7.0) list the rest, the claim, passkey and authentication attempt operations among them.

## Paths and responses

- **Breaking:** the login flow API lives under `/flows`: `POST /flows`, `GET /flows/{flow_id}` and `POST /flows/{flow_id}/submit`. `/flow` answers until 1.0.0, with a `Deprecation` header. The 0.7.0 clients, `<zitadel-login>`, SDKs, CLI and `@zitadel/testing` call `/flows`, which an older server answers with `404`, so upgrade a self-hosted server first.
- **Breaking:** `GET /events` answers `{ events: […], next_page_token }`; the events were under `data`. Use a 0.7.0 CLI against a server that has this.
- **Breaking:** `GET /branding` pages like every other list: it takes `limit` and `page_token`, holds 20 revisions a page unless `limit` asks for up to 100, and answers `{ branding: […], next_page_token }`. Use `listBranding.all(…)` or `zitadel branding list --all` for every revision.
- **Breaking:** `POST /schemas` answers with the schema it stored, `{ id, schema, metadata }`, so you no longer need a second read. In the Go client, `PublishSchema` returns `*Schema`.
- **Breaking:** in the Go client, `submitFlowStep` answers `400` with either the step or an error, and `api.DeploymentTarget` has no `ExpiresAt`. In `@zitadel/api`, `SubmitFlowStep400` is a union: check for `step` before reading it.

[API reference](https://preview.zitadel.com/docs/reference/api)
