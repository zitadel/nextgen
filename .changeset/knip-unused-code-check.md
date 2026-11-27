---
---

The published packages now check for unused files, exports and dependencies when they are linted, and `@zitadel/sdk-next` is built with Vite instead of `tsc`, keeping the same files in `dist`. The native server platform packages declare `"type": "module"` so their lint config loads; they ship only the server binary, so nothing changes for them either. Nothing a consumer imports changes.
