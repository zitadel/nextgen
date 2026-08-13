---
"@zitadel/cli": patch
"@zitadel/config": patch
"@zitadel/server": patch
---

Scaffolded `.zitadel/**` READMEs now show runnable `npx @zitadel/cli@<version> …` commands instead of the bare `zitadel` command, which does not exist inside a generated app. The branding dialect now explains that `layout` is the degrade preset (`centered`/`split`), not the design name — switch designs with `branding eject --design`. The branding README shows exactly where `logo_url`/`hero_url` go (and that custom fonts aren't configurable there yet), and the setup summary surfaces the `.zitadel/` customization entry points (user schema, login flow, login template) and pairs the chosen design's wizard label with its slug (e.g. "Split (reversed)" → `split-right`) so you can confirm the selection applied.
