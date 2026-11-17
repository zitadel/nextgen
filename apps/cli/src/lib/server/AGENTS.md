# Agent Instructions — `apps/cli/src/lib/server`

Where Zitadel runs, and how the CLI starts, finds and talks to it. The
package rules in [`apps/cli/AGENTS.md`](../../../AGENTS.md) apply here too; the
rules for the local server's files are in [`local/AGENTS.md`](local/AGENTS.md).

## The model

A runtime is where Zitadel runs. There are two kinds, and the type says which:

- `ZitadelRuntime` (abstract): an address, its `kind` (`cloud`, `self_hosted`,
  `local`, `unknown`), its console link and `hostUnlessDefault()`.
- `CloudRuntime`: a runtime the CLI only talks to, wherever it is: the hosted
  cloud, a team's own server, or an address on this machine that no folder
  started. `ZitadelRuntime.fromUrl(url)` always returns one.
- `LocalRuntime`: the server the CLI starts and stops in one project folder:
  `start`, `stop`, `status`, `logs`, `reset`, and the admin it created.
  `LocalRuntime.forFolder(dir, { cliVersion })` is the only way to get one.

An address alone is never manageable, even `http://localhost:8080`, because
only a folder says which server it started. `kind` says where a runtime is
(telemetry and setup read it); the class says what the CLI may do to it.
Passing a `CloudRuntime` where a `LocalRuntime` is wanted fails to compile,
which is why `stop`, `logs` and `status` ask for a `LocalRuntime`.

## Why a folder, and why walking up

A local server belongs to the folder `zitadel start` ran in, which is often a
parent of the app. Readers (`console`, `logs`, `setup`, `doctor`) find it by
walking up to the nearest `.zitadel/local/runtime.json`; writers (`start`,
`stop`, `reset`) act on exactly the folder they are given. Mixing the two
manages the wrong server: see [`local/AGENTS.md`](local/AGENTS.md).

## Who may reach in

- Everything outside `src/lib/server` imports `@/lib/server` and nothing
  deeper. `index.ts` exports classes, interfaces and their types. Biome's
  `noRestrictedImports` in `biome.json` fails a deeper import.
- Claiming a project is not a server concern: it lives in `lib/claim` and asks
  for an `AdminSession`. `Clock` is not either: it is `lib/clock.ts`.
- Setup asks about this machine through the `LocalMachine` interface
  (`local-machine.ts`). Production passes `SystemMachine`; tests pass the real,
  in-memory `ScriptedMachine` (`tests/helpers/local-machine.ts`). That is why
  setup's tests need no `vi.mock` of the server.

## Decisions, and why

- **One hierarchy, not `Server` + `LocalServer`.** Two classes with the same
  root name and no relationship read as a mistake. The base class is where a
  command asks `consoleLink()`-style questions without an `if local`.
- **A bare URL is a `CloudRuntime`.** Giving a `LocalRuntime` no folder made
  `stop()` fail at run time, not compile time. A loopback URL with no record
  was never manageable, so nothing is lost.
- **`--server`'s variable lives in `lib/oclif/base.ts`.** Flag metadata is CLI
  logic and does not belong in a package that must not know the CLI.
- **`StartedServer` keeps a per-run memo.** It is the one sanctioned mutable
  cache here: it keeps a record from being read twice before the run has a
  context. An entry is never replaced, only removed after a failed read.
- **Single-use private methods are inlined** (`status()` derives its lifecycle
  in place) so a class reads top-down.

## Review outcome (three independent reviews, adjudicated)

All three reviewers named the same central smell: about 35
`static readonly x = looseFunction` aliases on `LocalRuntime` make it a
namespace over loose functions. They disagreed on order, and this is the call:

1. **Typed failures, no CLI wording in the package.** The package throws
   `ServerError` subclasses carrying a code and plain data, and optionally emits
   progress events; a presenter in `src/cli` turns them into hints and
   suggested commands. Destructive `reset` takes a capability token, not
   `Consent`. Then a Biome rule forbids `@/lib/ui`, `@/lib/suggestion`,
   `@/lib/consent` and `@/lib/oclif` here.
2. **Helper modules become classes** (`RuntimeRecords`, `LocalLayout`,
   `AdminCredentials`, `ProjectEnv`, `LogParser`, `PortListeners`) with
   injected file system, ports, Docker and process table, so start, stop and
   logs are tested with real in-memory implementations, never mocks. A
   `BackendStrategy` replaces the repeated `backend === "binary"` branches.
3. **Split `LocalRuntime`** into a thin immutable facade over `LocalStart`,
   `LocalStatus`, `LocalStop`, `LocalLogs`, with `StartPolicy` and
   `StatusDeriver` as pure classes. `startLocked` is the cyclomatic hot spot.
4. **Per-directory `index.ts` barrels** for `local/` and `local/internal/`.

## What is still open on this branch

Not done yet, in the order above: everything under "Review outcome". Today the
package still imports `@/lib/consent`, `@/lib/suggestion` and `@/lib/ui/log`
and throws `ZitadelError` with CLI hints; the helper aliases are still
`static readonly` function references; `zitadel-runtime.ts` is still one
large file. The seams that already exist (`Lifecycle` with `Launcher`,
`ServerStore`, `PortProbe` and `HealthProbe`; `LocalServers`; `LocalMachine`)
are the ones to build on.
