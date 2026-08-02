# ADR 042: Scaffolded File Ownership and Drift Detection

> **Status:** Accepted
> **Date:** 2026-08-01
> **Context:** The `zitadel` CLI's scaffolded app files (orca patchers), the `doctor` command's verification contract, and the `scaffold` manifest in `.zitadel/state.json`.
> **Relates to:** [ADR 004](004-agent-contract-and-agents-md.md)

## Context

`zitadel setup` writes app files (routes, the request boundary, type
declarations) into the user's project. Before this decision, three artifacts
told three different stories about who owns those files afterwards:

- The managed-file marker (`// zitadel-cli: managed-file v1`) implied
  "CLI-owned until the user removes the marker" — that is `eject`'s semantic,
  which preserves marker-less files.
- `apps/cli/SKILLS.md` claimed `doctor` verifies "generated app files" and
  `doctor --fix` "re-applies missing managed files".
- The implementation did neither: no doctor check looked at scaffolded app
  files, and `doctor --fix` passed with `proxy.ts` — the file that makes
  `/__nextgen` proxying and route protection work — deleted. The repair
  machinery existed (`AbstractRulePatcher.repair` replays marker-bearing ops)
  but only the dependency check triggered it, and it repaired with
  `force: true`, which would overwrite user-edited marked files.

An agent-driven evaluation (2026-07-30, the "Wicklore" exercise) surfaced this
as the highest-leverage CLI defect: the one command whose job is to confirm
the integration is intact said yes when it was not. Design intent for the
missing check already existed in `docs/design/cli/bdui-renderer.md` ("The
CLI's `doctor` command verifies … scaffolded pages import it correctly") and
`docs/design/cli/PLAN.md` D.4 (drift detection against the last-applied
snapshot in `.zitadel/state.json`).

## Decision

### Ownership classes

Scaffolded app files split into two classes, declared by each patcher:

- **infrastructure** — load-bearing for the auth integration: the request
  boundary (`proxy.ts`/`middleware.ts`), the provider file, and the
  custom-elements declarations. Missing ⇒ `doctor` **fails**.
- **presentation** — the generated pages. They are a starting point released
  to the user; rewriting or deleting them is expected. Missing ⇒ `doctor`
  **warns**.

Per-file lifecycle states: `pristine` (bytes setup wrote), `edited` (marker
kept, content changed), `adopted` (marker removed — user owns the file, same
semantic as `eject`), `missing`. Edited and adopted files always pass; they
are the intended customization paths.

### Scaffold manifest

`zitadel setup` records what it actually wrote in a `scaffold` section of
`.zitadel/state.json`: per-file sha256 content hash and class, plus
`scaffolded_framework` (whether setup created the app skeleton — decides
whether the framework home page is CLI-managed) and `dev_port`. The manifest
makes verification exact: a conditional file the CLI never wrote is simply
absent, so it is never demanded from a pre-existing app.

Apps scaffolded before the manifest fall back to template-derived
expectations: presence-only checks over the patcher's marked files minus
conditionally-scaffolded ones. The fallback judges old scaffolds by current
templates, so template-set growth or a Next major upgrade across the
`middleware.ts`/`proxy.ts` boundary can misjudge manifest-less apps; that is
contained to the fallback and ends when `doctor --fix` materializes the
manifest (`setup` skips initialized projects, so `--fix` is the migration
path). A manifest-mode `--fix` likewise reconciles retired template paths:
an entry whose file is gone and which the current plan no longer writes is
dropped, and newly-introduced template paths the repair restored are
adopted — a Next 15→16 upgrade converges instead of failing forever.

Beyond whole files, the check verifies the managed *config wirings* — the
merges the CLI applies into user-owned config files (the Vite and Nuxt
dev-proxy/runtime merges, Angular's `angular.json` `proxyConfig` and auth
routes, the Angular `dev` script). Each merging transform is idempotent by
contract (it only adds what is missing), so running it against the current
content is a structural probe: a changed output means the wiring is absent.
Detached `infrastructure` wiring fails the check; a missing `convenience`
wiring (the `dev` script) warns; a transform that throws on restructured
content yields no verdict. `--fix` re-applies wirings by replaying the same
edit ops.

### `doctor --fix` is restore-missing-only

All repairs run through the patcher's `repair` with `missingOnly`: content
ops replay only when their target file does not exist, and additive ops
(env merges, gitignore entries) stay idempotent. The SDK dependency is
re-added only while absent — replacing a differing declared version would be
an overwrite of a user-pinned range, not a restore. A repair can therefore
restore a deleted managed file but can never overwrite an edited or adopted
one. On a pre-manifest app, a successful repair also materializes the
manifest from the marker-bearing files on disk (adopted files stay the
user's), completing the migration out of fallback mode. This deliberately **narrows** the dependency check's
previous `force: true` repair, which could clobber user edits; the flag's
documented text ("Re-apply missing managed files") already described the new
behavior. Restored files are re-hashed into the manifest — the bytes come
from the current templates, which may differ from what the original CLI
version wrote, and the manifest records that honestly.

The fix loop now runs for warned checks too (previously fail-only), so a
deleted presentation page — a warning — is still restorable. Any future
warn-emitting check inherits fix eligibility; fixes must stay safe to run on
warnings.

## Consequences

- `doctor`'s `managed-files` check makes the SKILLS.md description true;
  agents can trust `ok: true` to mean the integration's files are intact.
- The journey suite carries a drift probe (delete the boundary → doctor
  fails → `--fix` restores → doctor passes) on the Next framework, proving
  the published consumer path end to end.
- `eject`, the marker, the manifest, and doctor now tell one story:
  marker-less files are the user's; missing managed files are drift;
  `--fix` never destroys user work.
- Guidance merge-blocks in `README.md`/`AGENTS.md` are not covered by the
  check (they are sections, not files); a future revision may add them.
