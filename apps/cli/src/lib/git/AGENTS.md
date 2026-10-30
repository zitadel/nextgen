# Agent Instructions — `apps/cli/src/lib/git`

Package rules: [`../../../AGENTS.md`](../../../AGENTS.md). Tests:
[`../../../tests/AGENTS.md`](../../../tests/AGENTS.md).

Every git process the CLI starts goes through this module. It knows git, not
Zitadel: callers say what to leave out and whom to name as author.

## Shape

- Start git only through `Git.run`, which applies the same safety to every
  call; nothing else in `apps/cli` spawns `git`.
- Export only `Repository` and types from `index.ts`; callers never see git's
  arguments or output, so a git detail is fixed in one place.
- Add a capability as an `Operation` in `operations/` (`checks`, `refused`,
  `run`) plus a one-line `Repository` method that calls `perform`.
- Add a precondition as a `Check` in `checks/`, one class per condition, so
  each is unit-tested against every answer git can give.
- Keep Zitadel out: pass knowledge in (`except`, `authorIfGitHasNone`), never
  import from the rest of the CLI.
- Assume a modern git (2.25 or later); add no fallbacks or workarounds for
  older versions.
- Throw `RepositoryError` with git's own message; the caller decides whether a
  failure is fatal.

## Gotchas

The reason for each rule is in the doc of the class named.

- Never touch the developer's index; build in a `StagingArea`.
- Diff in one `git diff` call, never one per file (`DiffSince`).
- Stage only the files you keep, never add then unstage (`StagingArea.addAll`).
- Keep the copied index's timestamps (`StagingArea.startFromDevelopers`).
- Keep `--submodule=short` on the per-file diff only (`DiffFilesSince`).
- Keep `--no-verify` and `commit.gpgsign=false` on commits (`StagingArea.commit`).
- Refuse to commit while an operation is under way or HEAD is detached
  (`NoOperationUnderWay`, `HeadIsOnABranch`).
- Leave secrets out of a commit in any case (`isSecretPath`); exempt only
  `.zitadel/local/` as written from setup's clean-tree check (`isLocalRuntimePath`).

## Docs and code

- Give every class and method a doc that says what it does and why, naming
  the failure it prevents; put reasoning there, not in inline comments.
- Use `const` and explicit `if`/`else` branches; no `let`, no ternaries.

## Tests and reviews

- Mirror each source file under `tests/unit/lib/git/`; use `fakeGit` for
  every answer git can give and `GitScratch` with `isolateGit` for real git.
- Back every fix with a test that fails without it.
- Judge a change by: does it behave differently from before in a realistic
  case, could it commit a secret or lose work, or is it a regression.
- A review told to find anything always finds something; finish with a pass
  that checks only those three questions.
