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

## The base: `ServerCommand` (`base.ts`)

One base for every command about the local server, so none repeats the same
four things (the group, `meta`, a `sourceOf`, and the `ps` seam).

- `static folderRule`: `"exact"` acts on the folder the command runs in
  (`start`, `stop`, `reset`); `"nearest"` acts on the closest folder, that one
  or a parent, where `start` ran (`logs`). Choosing wrongly manages another
  project's server, so every command states it.
- `serverInThisFolder()` and `serverInNearestFolder()` return the runtime the
  command acts on. A command asks them; it never builds paths, names or
  addresses itself.
- `localServers()` is the test seam for the machine's process list. It lives
  here and not in `BaseCommand` because only these commands ask it.
- `status` is the one command about this server that does not extend it: it
  also reads the project's environment, so it extends `EnvironmentCommand`.
  `console` and `doctor` keep their own `sourceOf`.

## How a command reads

Top-down: a description, a group order and flags, then `execute`, which asks
the runtime and renders the answer. The runtime decides what a start, stop or
reset does (`plan()`, `launch()`, `stop()`, `reset()`, `follow()`); a command
only turns the answer into a result.

- Write every branch as `if`/`else`; no ternaries, no `let`.
- Explanations go in TSDoc on the class, not in comments inside a body.
- A dry run reports `plan()`: a `DockerStart` or a `BinaryStart`, never a loose
  record, so a binary start cannot carry an image or a container.

## Known limits

- `Destructive(ServerCommand)` loses the base's `static group`, so `reset`
  declares its group itself; `doctor` does too.
- `status` and `console` do not yet use `folderRule`.
