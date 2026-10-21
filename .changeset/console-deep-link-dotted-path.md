---
"@zitadel/server": patch
---

Reloading or opening a console or login UI link whose last path segment holds a dot, such as a schema whose id is its `$id` URL, now loads the page instead of answering 404, and so does any other missing path under the console or login UI. Missing files under `assets/` still answer 404.
