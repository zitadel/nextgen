---
"@zitadel/cli": minor
---

Preview a branch's release on its pull-request URLs with `zitadel preview`. Run inside a preview build, it reads the preview URLs from the hosting platform (Vercel or Netlify; pass Cloudflare Pages URLs with `--origin`) or from `--origin`, builds the same release `deploy` does, validates it without touching your live sign-in providers, and makes it live on those URLs for a time-to-live (`--ttl`, between 60s and 365d; omitted, the project's default applies). Its last line is `NEXT_PUBLIC_ZITADEL_RELEASE=sha256:...` for the build to pin. Outside a preview or development build it does nothing — even with an explicit `--origin` — because production is deployed by `zitadel deploy` after merge, and `--origin primary` or a primary origin's own URL is refused. On a CI platform other than Vercel or Netlify, set `ZITADEL_ENV=preview` in the pull-request build: a CI build that names no environment is skipped too.

`zitadel preview list` shows the project's live previews, and `zitadel preview rm <url>` ends one early. All three use the narrower preview token and never fall back to the project secret. `preview list` and `preview rm` fail, naming `ZITADEL_PREVIEW_TOKEN`, when it is not set; `zitadel preview` instead warns and still exits successfully unless `--strict` is passed.
