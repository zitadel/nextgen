# Environment Releases — Ticket Breakdown

> **ADR:** [ADR 035 — Environment Releases for Configuration Resources](../../adrs/035-configuration-environments.md)
> **Status:** Draft

Follow-up design work and implementation tasks for ADR 035. Follow-ups are ADRs and design notes that fill in what 035 explicitly deferred. Implementation tasks are what's needed to ship 035 itself.

---

## Follow-up tasks (design / ADRs)

### ADR — Environments

**Context.** ADR 035 treats environments as opaque runtime slots. Their internals (lifecycle, values, protection, cross-env isolation) are the largest deferred surface. A key open question is how a request selects an environment — likely via domains bound to envs, so the hot path resolves `domain → env → current release`.

**Description.** Define what an environment is beyond "a slot that runs a release." Cover creation, retirement, per-env values, env classes, cross-env data semantics, and domain-based env selection (data model, verification, hot-path lookup, TLS story, CLI surface).

**Acceptance criteria.**
- [ ] Lifecycle: how envs are created, renamed, retired; per-project defaults on setup.
- [ ] Env classes (production-class vs. preview/ephemeral) and what each implies.
- [ ] Per-env values (base URLs, template values) — shape and how releases reference them.
- [ ] Domain-based env selection: data model, verification flow, hot-path lookup, unknown-domain behavior, TLS story, CLI + API surface.
- [ ] Cross-env data isolation for users and sessions; the user-schema exception is explicit (users carry their pinned `sch_…`; GET honors it, PATCH resolves).
- [ ] Env-topic CLI: `zitadel env create/list/retire/show`.
- [ ] Whether `GET /environments` inlines a `release_summary` (message, git_sha) to save the N+1 fetch in `status`.
- [ ] Auto-deploy defaults for bare `zitadel deploy` (#449).

### ADR — Approvals / RBAC for deployments

**Context.** ADR 035 leaves out who can create, deploy, promote, or roll back — and what "protected env" means at the permission layer.

**Description.** Spec the permission model for release construction and deployment, plus approval workflows for gated envs.

**Acceptance criteria.**
- [ ] Roles / permissions for release construction and each deployment reason (`deploy`, `promote`, `rollback`).
- [ ] Approval flow representation (pending state, approver identity, notification hooks).
- [ ] Composition with env classes from the Environments ADR.

### ADR — Retention policy

**Context.** ADR 035 leaves how long superseded releases and orphaned revisions live undecided. Also flagged as a follow-up in ADR 009.

**Description.** Decide when releases and their revisions become eligible for deletion, and how deletion works.

**Acceptance criteria.**
- [ ] Retention rule for releases no env runs.
- [ ] Retention rule for revisions no release pins.
- [ ] Guardrails preventing collection of anything referenced by a deployment audit log.

### ADR — Inner-loop semantics

**Context.** "Is every local save a release?" — Vercel-shaped auto-release vs. Terraform-shaped explicit `deploy`. Affects local dev ergonomics.

**Description.** Decide the inner-loop model and how it maps to `zitadel deploy`.

**Acceptance criteria.**
- [ ] Explicit decision recorded (auto or explicit).
- [ ] Implications for `zitadel deploy` behavior in dev-mode.

### ADR — Secrets

**Context.** Secrets are out of scope in ADR 035, and out-of-scope for the Environments ADR beyond declaring they exist per env.

**Description.** Define secret storage, encryption, rotation, and template resolution (`${secrets.Y}`).

**Acceptance criteria.**
- [ ] Storage model (per-env, project-wide, or both).
- [ ] Template resolution semantics on deploy.
- [ ] Rotation and access-control story.

### Design note — CLI ergonomics

**Context.** ADR 035 records that `zitadel deploy` requires a release `message` but defers where the CLI sources it from.

**Description.** Pick the sourcing strategy and any related CLI conventions (`--dry-run`, `--json`, non-interactive rules).

**Acceptance criteria.**
- [ ] Decision on message source (git commit subject, `-m`, interactive prompt, config).
- [ ] `--json` output convention for `status`, `releases list`, `deployments list`.
- [ ] Non-interactive rules (which flags are required when).
- [ ] Draft-enumeration UX: `zitadel status --include-drafts` or `zitadel pull --list` — decide on the surface (or explicit defer).

### Design note — Content hashes on revisions

**Context.** `zitadel status` needs to compare local vs. release content per resource. Today it fetches bytes; a content hash on the per-kind read would let it short-circuit.

**Description.** Add a stable `content_hash` field to per-kind read responses.

**Acceptance criteria.**
- [ ] Content hash is deterministic across servers for identical content.
- [ ] `zitadel status` uses it to skip byte-diffs on matching hashes.

### Design note — Handle conventions per kind

**Context.** ADR 035 mentions handles (`objectType` for schemas, `name` for others) but doesn't enumerate them.

**Description.** Publish a reference table for `(kind → handle field → list-revisions endpoint)` covering the kinds that exist today (schemas, flows) and any others as they land.

**Acceptance criteria.**
- [ ] Table exists and is linked from ADR 035.
- [ ] `zitadel pull` reads from it (or a code-level equivalent).

### Reply to @grvijayan's inline plan/drift question on PR #478

**Context.** Discussion `r3558634926` on PR #478 is still open.

**Description.** Post the one-sentence reply.

**Acceptance criteria.**
- [ ] Reply posted; thread resolved.

---

## Implementation tasks

### Parent — Ship Environment Releases (ADR 035)

**Context.** Configuration today is applied per-resource with no atomicity, no snapshotting, and no separation between environments. ADR 035 replaces this with immutable releases (revision pointers + audit metadata), environments that run one release at a time, and atomic pointer-swap deployments with promote/rollback for free.

**Description.** Ship the model end-to-end: flow-definition revisioning, releases + deployments persistence and endpoints, hot-path resolution through the env → current release pointer, and the new CLI surface (`deploy`, `status`, `pull`, `promote`, `rollback`, list commands) with `apply` and `plan` removed. Sub-tasks below.

**Acceptance criteria.**
- [ ] `zitadel deploy` on a scratch project constructs a release and deploys it to a fresh env in one atomic operation; a mid-run failure leaves nothing committed.
- [ ] `zitadel promote --from dev --to prod` runs the same `release_id` on both envs; no revisions minted.
- [ ] `zitadel rollback --env prod` returns the env to its previous release; the deployment audit log records the rollback.
- [ ] `zitadel status` reports in-sync / ahead / behind correctly across the scenarios documented in ADR 035.
- [ ] `zitadel pull schema <handle>` followed by `zitadel deploy` folds a dashboard-drafted edit into a new release.
- [ ] Hot-path auth reads the env's current release once per request; a pointer swap during an in-flight request never yields a mixed release.
- [ ] `zitadel apply` and `zitadel plan` are removed from the CLI surface.

### Server — Revisioning for flow definitions

**Context.** User schemas already have revisions (#456). Flow definitions are the other configurable kind that exists today; releases can't work until flows are revisioned too. Other kinds (idps, brandings, apps, policies) get the same treatment when they land, but are not in scope here.

**Description.** Extend the schemas-style revisioning model (opaque id, handle grouping by `name`, list-revisions endpoint) to `flow_definitions`.

**Acceptance criteria.**
- [ ] A flow definition write allocates a new opaque revision id; previous revisions stay addressable.
- [ ] `GET /flow_definitions?name=<handle>` returns revisions of that flow, newest first.
- [ ] Direct CRUD creates a new revision; no in-place mutation.

### Server — Releases persistence & endpoints

**Context.** Releases are the central new artifact.

**Description.** Add `releases` storage + `POST /releases`, `POST /configuration-releases`, `GET /releases`, `GET /releases/{id}`.

**Acceptance criteria.**
- [ ] Releases store audit metadata and `(kind, handle, revision_id)` tuples; no content embedded.
- [ ] `POST /configuration-releases` allocates revisions and assembles the release in one transaction.
- [ ] Empty bundles are rejected.
- [ ] Same-content re-submission is idempotent (returns existing `release_id`).
- [ ] `GET /releases/{id}` returns pointers + audit metadata.

### Server — Environments & deployments persistence & endpoints

**Context.** Envs are runtime slots; deployments are the append-only audit log.

**Description.** Add `environments` table (with cached `current_release_id`) and `deployments` table (append-only). Endpoints for reading envs, listing deployments, and creating a deployment atomically.

**Acceptance criteria.**
- [ ] Env row caches `current_release_id` / `current_deployment_id` for the hot path.
- [ ] Deployment writes are transactional: insert log row + update env pointer.
- [ ] `POST /environments/{env}/deployments` accepts `{ release_id, reason }` and returns the new deployment.
- [ ] `GET /environments` and `GET /environments/{env}` include current deployment inline.
- [ ] `GET /environments/{env}/deployments` returns history newest-first.

### Server — Hot-path resolution refactor

**Context.** Auth today reads "latest revision of X." Under releases, it reads "X within the env's current release."

**Description.** Update every hot-path resolution of a configurable resource to go through the env → release pointer.

**Acceptance criteria.**
- [ ] Auth flow reads env's `current_release_id` once per request, resolves handles from the release.
- [ ] Pointer swap during an in-flight request never yields a mixed release.
- [ ] Every resource kind referenced in the auth flow is exercised by tests.

### CLI — New commands

**Context.** ADR 035 defines a new CLI surface.

**Description.** Implement `deploy`, `status`, `pull <kind> <handle>`, `promote --from <env> --to <env>`, `rollback --env <env>`, `releases list`, `deployments list --env <env>`.

**Acceptance criteria.**
- [ ] Each command works interactively and non-interactively.
- [ ] `deploy` / `promote` / `rollback` compute removals against target env's current release and require confirmation (or `--confirm-removals`).
- [ ] `status` renders the human-friendly output from ADR 035 for aligned, ahead, mid-promotion, and behind states.
- [ ] `pull` fetches the newest revision of a resource and writes it into `.zitadel/` with handle-based refs.

### CLI — Remove `apply` and `plan`

**Context.** Both commands are removed under ADR 035.

**Description.** Delete the commands and update all docs referencing them.

**Acceptance criteria.**
- [ ] `apply` and `plan` no longer registered in the CLI.
- [ ] `SKILLS.md`, `apps/cli/README.md`, and other docs no longer reference either.

### Tests — Release construction and deployment

**Context.** The atomic construction + pointer-swap behavior is what makes ADR 035 worthwhile.

**Description.** Add integration coverage for the guarantees the ADR relies on.

**Acceptance criteria.**
- [ ] Partial failure during construction leaves no release and no revisions committed.
- [ ] Same-content re-submit returns the existing `release_id` (idempotency).
- [ ] A deployment rejection leaves the env pointing at the previous release.
- [ ] Hot-path resolution during a pointer swap never returns a mixed release.

### API docs / OpenAPI

**Context.** New endpoints and shape changes must land in the generated client.

**Description.** Update OpenAPI specs and regenerate the API client package.

**Acceptance criteria.**
- [ ] New endpoints appear in `packages/api/src/generated/`.
- [ ] Response shapes for `GET /environments*` include the current deployment.
