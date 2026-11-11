---
"@zitadel/server": patch
---

Deactivating a user now ends the access their direct grants give them on their next request, including through sessions they already hold, and `GET /projects/{project_id}/admins` stops listing them. Before, only the access they had through teams ended.
