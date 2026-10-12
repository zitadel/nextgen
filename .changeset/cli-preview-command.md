---
"@zitadel/cli": minor
---

Preview a branch's release on its pull-request URLs with `zitadel preview`. Run inside a preview build, it reads the preview URLs from the hosting platform (Vercel, Netlify or Cloudflare Pages) or from `--origin`, builds the same release `deploy` does, validates it without touching your live sign-in providers, and makes it live on those URLs for a time-to-live (`--ttl`, default 7d, between 60s and 30d). Its last line is `NEXT_PUBLIC_ZITADEL_RELEASE=sha256:...` for the build to pin. In a production build with no `--origin` it does nothing, because production is deployed by `zitadel deploy` after merge.

`zitadel preview list` shows the project's live previews, and `zitadel preview rm <url>` ends one early. All three use the narrower preview token and fail, naming `ZITADEL_PREVIEW_TOKEN`, when it is not set — they never fall back to the project secret.
