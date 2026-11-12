---
"@zitadel/server": minor
"@zitadel/api": minor
---

The console no longer offers the platform project it signs in to as a project to choose: it is the root, with the projects beneath it. The root's sidebar lists Projects, then the platform project's Users and Events for someone who can act on it, such as a platform operator, then Settings. It no longer lists a project's screens; choose a project to reach them. Projects, the project switcher and search leave the platform project out, and a user found in it opens in the root's Users. Settings keeps Billing, Support and Email, and your own profile moves to the account menu, at `/account`.

The platform project holds who may use the platform, so the server now refuses to have its configuration written through the API: adding or removing an origin, building, creating or revoking a release, creating or rolling back a deployment, ending a preview, and writing a variable, a schema, a flow definition, a policy, branding or an identity provider on it answer `403` with the resource's `permission_denied`. Reading it is unchanged, and so is every other project, including a project a self-hosted server pins with `platform.project_id`. `GET /users/me/projects` takes `exclude_platform` to leave the platform project out ([List my projects](https://preview.zitadel.com/docs/reference/api/projects)).
