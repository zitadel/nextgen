---
title: Preview a branch's release on its pull-request URLs
summary: Run zitadel preview in a preview build, and the release your branch builds goes live on its pull-request URLs for as long as you choose. A variable can hold a value of its own for previews.
date: 2026-10-27T23:26Z
pulls: [1652]
---

Run `zitadel preview` inside a preview build on Vercel or Netlify, and it reads the preview URLs from the platform, builds the same release `deploy` does, validates it without touching your live sign-in providers, and makes it live on those URLs for a time-to-live: `--ttl`, between 60s and 365d, or the project's default without one. On Cloudflare Pages, pass the URLs with `--origin`. Its last line is `NEXT_PUBLIC_ZITADEL_RELEASE=sha256:...` for the build to pin.

- Outside a preview or development build it does nothing, even with `--origin`: production is deployed by `zitadel deploy` after merge. On a CI platform other than Vercel or Netlify, set `ZITADEL_ENV=preview` in the pull-request build.
- `zitadel preview list` shows the project's live previews, and `zitadel preview rm <url>` ends one early.
- All three authenticate with `ZITADEL_PROJECT_SECRET` for now. Without it, `preview list` and `preview rm` fail, naming the variable, and `zitadel preview` warns and still exits successfully, unless you pass `--strict`.

## Variables with a preview value

Variables now belong to the project, under `zitadel variable`, and hold a primary value, which primary deployments freeze, and a preview value, which previews freeze, with no fallback between them. A plain `variable set` writes both, a secret only the primary, and `--preview` works with the preview value alone. `variable resolve` shows what a live deployment runs.

**Breaking:** the `variables` commands and the `--project-level` flag are removed. Drop `--project-level`, and use `variable set NAME`, `variable get NAME`, `variable list` and `variable rm NAME` in place of `variables set`, `get`, `list` and `delete`.

[zitadel preview](https://preview.zitadel.com/docs/reference/cli/preview), [zitadel variable set](https://preview.zitadel.com/docs/reference/cli/variable/set)
