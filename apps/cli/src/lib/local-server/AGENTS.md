# Agent Instructions — `apps/cli/src/lib/local-server`

How `zitadel start`, `stop`, `status`, `logs`, `reset`, `console` and `doctor`
run and find a directory's local server. The package rules in
[`apps/cli/AGENTS.md`](../../../AGENTS.md) apply here too.

## The rule everything here serves

Each directory runs its own server, on its own port, with its own data and
admin credential, and the CLI talks only to the server a
`.zitadel/local/runtime.json` names.

- Commands that write or remove local state act on the working directory.
  Readers (`setup`, `doctor`, `console`, `logs`) take the nearest record up
  the tree (`findUpward` in `runtime.ts`).
- Never fall back to a default port.
- Never trust a recorded URL or pid on its own: the record's own process or
  container must be the one serving (`LocalServer.resolveUrl`).

## Where things live

- Commands may import any top-level module here; `internal/` is private to
  `server.ts` (`LocalServer`).
- A command that needs more from a running server gets it from a new
  `LocalServer` method (and a launcher method), not code of its own.
- `internal/lifecycle.ts` decides against interfaces (reuse, restart, port,
  failure), so its tests need no processes, sockets or real time.

## Rules that each came from a real failure

- A pid is not an identity: a record's server is running only if a process in
  its group runs the server program on that record's data directory. List
  processes with `ps axww`; without `ww`, `COLUMNS` truncates the path.
- Skip the identity check for a server `launch` just returned: on Linux, `ps`
  shows it under its parent's name until it has exec'd.
- Decide whether a port is free by connecting and binding, never with `lsof`
  (a failed listing reads as "free"). Use `lsof` only to name a port's holder.
- Claim a port with `PortProbe.reserve` before launching and hold it until the
  server answers, or two concurrent starts pick the same port.
- Never start the server through `@zitadel/server`'s wrapper script: the
  recorded pid must be the process that holds the port.
- Take a requested port as asked or refuse it, and check it before tearing
  anything down, so a refusal leaves the working server running.
- Read a failed start's log before cleaning up; removing a container removes
  its log.
- Handle the spawn `error` event: an unrunnable binary reports through it, and
  unhandled it crashes the CLI.

## Tests

Layout and specs: [`tests/AGENTS.md`](../../../tests/AGENTS.md).

- Never wait in real time: code that waits takes a `Clock`
  (`internal/clock.ts`), and tests pass `ManualClock` (`tests/helpers/clock.ts`).
- Get a deterministic outcome by construction (the `orphaned` shape in
  `tests/helpers/local-server.ts`), never by sleeping.
- Make no test depend on whether Docker is installed: fake Docker, or take
  `docker` off `PATH`.
- A process standing in for a server whose data directory is checked must show
  its environment to `ps`, as Node does. macOS hides it for its own programs
  (`/bin/sleep`), so such a test passes on Linux and fails on a Mac.
