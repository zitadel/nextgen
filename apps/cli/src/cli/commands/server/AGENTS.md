# Agent Instructions — `apps/cli/src/cli/commands/server`

The commands about the Zitadel server that runs on this machine: `start`,
`stop`, `logs`, `reset`, `console` and, by way of the same base, `doctor`. The
package rules in [`apps/cli/AGENTS.md`](../../../../AGENTS.md) apply, and the
server package they call is described in
[`src/lib/server/AGENTS.md`](../../../lib/server/AGENTS.md).

## Layout and ids

- This folder only groups the files. A command's id comes from the explicit
  table in `src/index.ts`, so `server/start.ts` is still `start`.
- Tests mirror it: `tests/unit/cli/commands/server/<command>.test.ts`.

## The base: `LocalServerCommand` (`src/cli/commands/server-command.ts`)

`LocalServerCommand(Base, folderRule)` is the one base for every command about
the local server, so none repeats the same things (a `sourceOf`, and the `ps`
seam). It is a mixin like `Promptable`; the rest of the server family
(`ServerCommand`, `ChoosingServerCommand`) is in the same module and described
in [`apps/cli/AGENTS.md`](../../../../AGENTS.md).

- `folderRule` is its argument: `"exact"` acts on the folder the command runs in
  (`start`, `stop`, `reset`); `"nearest"` acts on the closest folder, that one
  or a parent, where `start` ran (`logs`). Choosing wrongly manages another
  project's server, so every command that has a rule states it. `console` and
  `doctor` have none and name their own `sourceOf`.
- `serverInThisFolder()` and `serverInNearestFolder()` return the runtime the
  command acts on. A command asks them; it never builds paths, names or
  addresses itself.
- `localServers()` is the test seam for the machine's process list. It lives
  here and not in `BaseCommand` because only these commands ask it.
- It sets no group and takes no `--server`: each command declares its own
  `group`, and one that reads `--server` wraps `ServerCommand` inside it. Each
  names no server before its flags are parsed (`resolveServer` returns none),
  because its server is the one its folder started, which `sourceOf` reads; for
  `start`, `stop`, `logs` and `reset` `--server` is accepted and ignored.
- `status` is the one command about this server that does not extend it: it
  also reads the project's environment, so it extends
  `ServerCommand(EnvironmentCommand)`.

## How a command reads

Top-down: a description, a group order and flags, then `execute`, which asks
the runtime and renders the answer. The runtime decides what a start, stop or
reset does (`plan()`, `launch()`, `stop()`, `reset()`, `follow()`); a command
only turns the answer into a result.

- Write every branch as `if`/`else`; no ternaries, no `let`.
- Explanations go in TSDoc on the class, not in comments inside a body.
- A dry run reports `plan()`: a `DockerStart` or a `BinaryStart`, never a loose
  record, so a binary start cannot carry an image or a container.
