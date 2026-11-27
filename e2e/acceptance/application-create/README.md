# Acceptance — `application create` and public OAuth clients

Executable acceptance for [#3294](https://github.com/zitadel/nextgen/issues/3294)
(`zitadel application create`) and the public-client OAuth runtime from
[#3409](https://github.com/zitadel/nextgen/pull/3409) /
[#3410](https://github.com/zitadel/nextgen/pull/3410).

| File | Covers |
| --- | --- |
| [`applications-create.feature`](applications-create.feature) | CLI create: web / spa / native, interactive, Help me choose, errors, `--json`, env write |
| [`oauth-public-clients-manual.feature`](oauth-public-clients-manual.feature) | Discovery, authorize (PKCE / schemes / loopback), token AuthMethodNone, CORS `*` caveat |

Not wired into CI. Walk against a local binary on the stack tip (or merged
main once landed).

## How to run

1. Build and start a local server from this checkout:

   ```bash
   pnpm --dir ../.. run cli -- start --runtime binary --non-interactive --json --cwd <workdir> --no-telemetry
   ```

2. Put `NEXTGEN_OAUTH_ENABLED=true` in the start cwd's `.env.local`, restart,
   then in the app project: `settings oauth enable` and `deploy`.

3. `setup --server local` (or reuse a project with env cascade credentials).

4. Execute the scenarios in both `.feature` files (CLI for create; curl /
   browser for OAuth). Discovery uses the RFC 8414 path until an OIDC layer
   exists; the feature documents that alternate.

5. Append a dated report under [`results/`](results/) — do not overwrite a
   prior run. Redact local IDs and secrets.

## Latest walk

See [`results/2026-11-27-slice4-tip.md`](results/2026-11-27-slice4-tip.md)
(tip `e4e2015b1` on `cursor/application-create-slice4-5407`).
