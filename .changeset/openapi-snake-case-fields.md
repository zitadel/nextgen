---
"@zitadel/server": minor
---

Rename the last camelCase wire fields in the OpenAPI spec to snake_case, so the whole API uses one convention.

**Breaking:** every renamed property changes on the wire. An unknown property is dropped rather than rejected, so a client left on the old names sends and reads silently empty values instead of failing loudly — update all of them together.

Request and response properties:

- `POST /projects` request: `previewOrigins` → `preview_origins`, `seedDefaults` → `seed_defaults`
- `POST /projects` response: `projectSecret` → `project_secret`, `previewSecret` → `preview_secret`, `previewOrigins` → `preview_origins`, `createdAt` → `created_at`
- `GET /projects/{project_id}` and the project query response: `previewOrigins` → `preview_origins`, `createdAt` → `created_at`, `updatedAt` → `updated_at`
- Team responses: `createdAt` → `created_at`, `updatedAt` → `updated_at`
- User `metadata`: `createdAt` → `created_at`, `updatedAt` → `updated_at`
- `PUT /users/{user_id}/password` request: `isChangeRequired` → `is_change_required`
- `GET /schemas` response items: `createdAt` → `created_at`

Filter and sort field values (the enum value, not the property name): `POST /projects/query` and `POST /teams/query` take `created_at` instead of `createdAt` in `filter[].field` and `sorting.field`. An old `createdAt` value is now rejected as an invalid enum value.

Stored user-schema documents are unaffected: `objectType` and `metaSchema` keep their names, since they are schema content rather than envelope fields.
