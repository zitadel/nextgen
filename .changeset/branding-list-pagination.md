---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/cli": minor
---

`GET /branding` now pages like every other list: it takes `limit` and
`page_token` and answers `{ branding: […], next_page_token }`, so a project's
whole branding history is readable rather than its newest 100 revisions
([API reference](https://preview.zitadel.com/docs/reference/api/branding/listBranding)).
`zitadel branding list` takes `--limit`, `--page-token` and `--all` with it.

**Breaking:** the response of `GET /branding` is an object, no longer a bare
array. Read the revisions from its `branding` field, and follow
`next_page_token` for more than one page: a page holds 20 revisions unless
`limit` asks for up to 100. In `@zitadel/api`, `listBranding` returns that
object; use `listBranding.all(…)` for every revision. In the Go client,
`ListBrandingResponse` is a struct with `Branding` and `NextPageToken`.
`zitadel branding list` prints one page; pass `--all` for every revision.
