---
"@zitadel/server": minor
"@zitadel/api": minor
---

The console no longer offers the platform project it signs in to as a project to choose: it is the root, with the projects beneath it. For someone who can act on it, such as a platform operator, the root's sidebar lists its screens beside Projects (Teams, Users, User schemas, Login flows, Branding, Deployments, Authentication and Events), and its Settings pages, General and Admins, head the root's Settings list. Everyone else sees Projects and Settings as before, without a project's screens in that list; choose a project to reach them. Projects, the project switcher and search leave the platform project out. Your own profile moves to the account menu, at `/account`.

Writing the platform project's configuration now asks for its admin role, where another project asks for editor: adding an origin, building, creating or revoking a release, creating or rolling back a deployment, ending a preview, and writing a variable, a schema, a flow definition, a policy, branding or an identity provider on it answer `403` with the resource's `permission_denied` to anyone granted less. A platform operator holds that role. Every other project is unchanged, including a project a self-hosted server pins with `platform.project_id`. `GET /users/me/projects` takes `exclude_platform` to leave the platform project out ([List my projects](https://preview.zitadel.com/docs/reference/api/projects)).
