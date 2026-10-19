# Agent Instructions — `apps/cli/src/lib/local-server`

How `zitadel start`, `stop`, `status`, `logs`, `reset` and `console` run and find a
directory's local Zitadel server. Read this before changing any of them.

## The rule everything here serves

Every directory runs its own server, on its own port, with its own data and its own
admin credential, and the CLI only talks to the server that directory's own
`.zitadel/local/runtime.json` names. This exists because a second directory once
attached silently to the first one's server on port 8080 and signed in with a
password that server had never imported (issue #1863). So: nothing falls back to a
default port, a recorded URL is never trusted on its own, and a recorded pid is
never trusted on its own.

## Where things live

`server.ts` is the only public entry point: `LocalServer`. Commands call it and
nothing under `internal/`. When a command needs something the class does not
offer, add it to the class (and to a launcher if it is about running a server),
not to the command.

`internal/lifecycle.ts` decides what to do (reuse, restart, which port, when a
start has failed) against interfaces, so it is tested with no processes, sockets
or real time. `internal/binary-launcher.ts` and `internal/docker-launcher.ts` know
how to run, find and stop a server. `internal/probes.ts` and `internal/store.ts`
are the real port, health and record implementations. `internal/failures.ts` turns
the lifecycle's typed errors into the messages commands report.
`internal/start-lock.ts` is the one-start-at-a-time lock, also used to claim ports.
`runtime.ts` is the record on disk and where it is looked for; it does not decide
whether a server is running.

## Rules that each came from a real failure

- A pid is not an identity. Pids are reused and every directory's server runs the
  same program, so a record's server is "running" only if a process in its group
  runs the server program and serves that record's data directory. Reading the
  process list needs `ps axww` (without `ww`, `COLUMNS` cuts a long path short
  and a running server looks foreign). A server that `launch` has just returned
  is not identity-checked: on Linux `ps` shows it under its parent's name until
  it has exec'd.
- Decide whether a port is free by connecting to it and binding it, never by
  listing sockets with `lsof`: a failed or timed-out listing reads as "free".
  `lsof` is only for naming who holds a port in an error message.
- Claim a port (`PortProbe.reserve`) before launching on it and hold the claim
  until the server answers, or two starts at once pick the same port and the loser
  reports itself ready on the winner's server.
- Never start the server through `@zitadel/server`'s wrapper script. The recorded
  pid must be the process that holds the port, and `@zitadel/server` owns the one
  list of platforms and where each binary is.
- A port that was asked for is taken as asked or refused, never moved, and it is
  checked before anything is torn down: a refused move leaves the working server
  running.
- Read a failed start's log before cleaning it up. Cleaning up a container removes
  its log, which is the only explanation of why it failed.
- Handle the spawn `error` event. A binary that cannot be run is reported by an
  event, not thrown, and unhandled it crashes the CLI with a stack trace.

## Tests

No test waits in real time. Code that waits takes a `Clock` (`internal/clock.ts`)
and tests pass `ManualClock` from `tests/helpers/clock.ts`; code that needs a
deterministic outcome gets it by construction (see the `orphaned` server shape in
`tests/helpers/local-server.ts`), not by sleeping. Ports in tests come from
`tests/helpers/ports.ts`, never from a bind-and-close probe. Unit tests mirror the
file they cover; command behaviour belongs in that command's spec, arranged
through `ScaffoldedApp`. The layout rules are in
[`tests/AGENTS.md`](../../../tests/AGENTS.md).

The suite runs on CI's Linux, which has Docker, and on contributors' machines,
Macs without Docker among them. So no test depends on whether Docker is
installed: one that needs Docker to answer fakes it, and one about a machine
without it takes `docker` off `PATH`. A process that stands in for a server whose
data directory is checked must be one whose environment `ps` shows, such as Node:
macOS keeps the environment of its own programs (`/bin/sleep`) out of `ps`, and a
process whose environment names no data directory is trusted, so with `sleep` the
test passes on Linux and fails on a Mac.
