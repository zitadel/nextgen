---
"@zitadel/cli": patch
---

`zitadel setup --renderer` now only advertises implemented renderers: `--help` lists `react` and calls out the planned `web-component` renderer as not yet available instead of offering it as an equal option. Passing `--renderer web-component` explicitly now fails at flag parsing — before any remote project is created — rather than mid-setup.
