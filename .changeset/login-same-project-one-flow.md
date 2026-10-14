---
"@zitadel/components": patch
---

`<zitadel-login>` no longer starts a second flow when the project it already runs arrives through another channel. A server-rendered widget that booted from its `project-id` and `proxy-path` attributes and is handed the same project as a `project` handle after it resumes now keeps its first flow, because the restart check compares the project the widget resolves to, not which of the handle, the global config or the attributes supplied it. A handle that names a different project still starts a fresh flow.
