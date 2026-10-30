# Agent Instructions — `apps/cli/src/lib/git`

Package rules: [`../../../AGENTS.md`](../../../AGENTS.md). Tests:
[`../../../tests/AGENTS.md`](../../../tests/AGENTS.md).

Every git process the CLI starts goes through this module. It knows git, not
Zitadel: callers say what to leave out and whom to name as author.

## Why it is one module

- Each git call needs the same safety (inherited `GIT_DIR`, locale, glob
  pathspecs, hooks, prompts); `Git.run` applies it once, so no caller forgets.
- Callers ask questions (`commitAll`, `diffSince`); they never see git's
  arguments or output, so a git detail is fixed in one place.
- Every condition and step is its own class, so each is unit-tested against
  every answer git can give, without a repository.

## Shape

- Start git only through `Git.run`; nothing else in `apps/cli` spawns `git`.
- Export only `Repository` and types from `index.ts`; callers use nothing else.
- Add a capability as an `Operation` in `operations/` (`checks`, `refused`,
  `run`) plus a one-line `Repository` method that calls `perform`.
- Add a precondition as a `Check` in `checks/`, one class per condition.
- Keep Zitadel out: pass knowledge in (`except`, `authorIfGitHasNone`), never
  import from the rest of the CLI.
- Throw `RepositoryError` with git's own message; the caller decides whether a
  failure is fatal (`lib/release/git.ts` turns it into null).

## Gotchas

- Never touch the developer's index: build commits and diffs in a
  `StagingArea`; it may hold another package's staged work.
- Diff in one `git diff` call, never one per file: a path also matches what is
  under it, and hundreds of processes run out of open files.
- Stage only the files you keep; adding then unstaging writes an excluded
  file's content (a `.env`) to `.git/objects`.
- Copy the developer's index with its timestamps; a fresh mtime hides an edit
  made in the same second as their last `git add`.
- Pair `--raw -z` entries with patch sections by order; keep
  `--submodule=short` there, or a submodule shifts every later file.
- Keep `--no-verify` and `commit.gpgsign=false` on commits; a scaffolded app's
  pre-commit hook or a signing prompt would block setup.
- Refuse to commit mid-merge, rebase, cherry-pick, revert or bisect, or on a
  detached HEAD; the commit would land where the developer did not mean.
- Match secrets case-insensitively (`.ENV` is `.env` on macOS) but
  `.zitadel/local/` with its case; it names only what `start` writes.

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
