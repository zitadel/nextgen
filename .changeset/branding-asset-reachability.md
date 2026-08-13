---
"@zitadel/components": patch
"@zitadel/config": patch
"@zitadel/cli": patch
---

A branding asset URL that is well-formed but unreachable no longer fails
silently. `logo_url` / `hero_url` cleared every gate — the CLI's shape check
and the server's save gate — published a revision, and then rendered as a 0×0
`<img>`: no plan output, no apply output, no console error.

Three changes close that hole:

- `plan` and `apply` probe each asset URL (HEAD, 2.5s budget, in parallel) and
  emit a non-blocking warning when it is unreachable, returns a non-2xx
  status, or answers with something that is not an image. Advisory by design —
  the machine planning is not necessarily the machine rendering the login
  page — so it never fails a run. Set `ZITADEL_SKIP_ASSET_PROBE` to turn it
  off (offline, air-gapped CI, a CDN that only resolves from production) and
  `ZITADEL_ASSET_PROBE_TIMEOUT_MS` to retune the per-URL budget. Only public
  HTTPS destinations are contacted and redirects are re-validated;
  loopback/private/internal targets remain inconclusive rather than becoming
  network requests from the machine running the plan.
- The login UI hides an asset that fails to load and restores either the split
  designs' decorative placeholder or the shipped design's authored no-logo
  content, so a broken asset degrades to the same result as no asset instead
  of a blank pane or missing compact brand. Templates could not do this
  themselves: they are DOMPurify-sanitised and inline `onerror` is stripped.
- Branding revisions can now carry plan warnings at all; previously only
  create/update actions could, and branding is revisioned.

Two readability fixes ride along. A branding `plan` no longer dumps the whole
inlined Liquid template as one escaped line: an unchanged multi-line field
renders as `(<n> lines, sha256:…)` and a changed one as a real line diff. And
the branding dialect file scaffolded into `.zitadel/meta/` now spells its
command mentions the way the generated app can run them
(`npx @zitadel/cli@<version> apply`), matching the READMEs — the bare
`zitadel apply` in the editor tooltip named a command that does not exist
there.
