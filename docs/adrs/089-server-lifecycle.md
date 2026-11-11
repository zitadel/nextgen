# ADR 089: A Server That Runs Only While It Serves a Request

> **Status:** Implemented
> **Date:** 2026-11-10
> **Builds on:** [ADR 048](048-wide-events-internal-audit-primitive.md)
> (request events wait for their write),
> [ADR 049](049-events-api-retention-export.md) (the purge's trigger) and
> [ADR 001](001-server-cli-cobra-viper.md) (configuration).
> **Related:** [ADR 065](065-background-jobs.md) (a job loop is background
> work like any other).

## Context

Some platforms run a process only while it starts or serves a request and
pause it in between: a Vercel function, a Cloud Run service with CPU allocated
only during requests. What the server does outside a request then runs late,
at the next request, or never.

The hosted cloud met this three times, one incident each, and got one setting
each: `events.retention.trigger_secret` (a cron call replaces the purge's
timer), `events.request.flush_wait` (a request waits for its audit event) and
`server.idle_timeout` `0` (a connection the proxy reuses is not closed by a
timer that expired during the pause). The cloud's launcher set all three by
name. A self-hoster on such a platform has to find the same three, and the
rest of the background work had no answer at all: the export shipper, the
service ping and the master-key re-wrap at start. Nothing made the next
background task answer either.

## Decision

### 1. One setting that states the fact

`server.request_bound` (`NEXTGEN_SERVER_REQUEST_BOUND`), `false` by default,
says that the process runs only while it starts or serves a request.

It is a fact about where the server runs, not a mode. It names no behavior
and turns nothing on; each part of the server draws its own conclusion from
it. The settings that exist stay the mechanism.

### 2. Every background task says what it does under it

Background work starts through `internal/background`. A task declares one of
three answers for a request-bound process:

- **In a request.** The work is done while the process runs: a request waits
  for it, or the server does it before it takes its first request.
- **On a trigger.** The work runs once per call to an endpoint that a
  scheduler outside the process calls.
- **Unsupported.** The start fails while the task is on, with an error that
  names the task and the setting that turns it off.

A task with no answer fails the start in every process, request bound or not,
so the gap shows on a developer's machine. The `backgroundlint` analyzer
(`server:lint`) reports a goroutine started anywhere else, unless a
`//background:allow <reason>` comment names its task or says why it is not
background work.

| Task | Request bound |
| --- | --- |
| Request audit events (flusher) | In a request: `events.request.flush_wait`; the start fails when it is `0` |
| Event retention (purge) | On a trigger: `/cron/events-retention`; the start fails without `events.retention.trigger_secret` |
| Event export (shipper) | Unsupported |
| Service ping | Unsupported |
| Master-key re-wrap | In a request: before the first one, and only while a previous key is configured |

No task may silently never run.

### 3. The settings a pause changes take their defaults from it

| Setting | Default | With `server.request_bound` |
| --- | --- | --- |
| `events.request.flush_wait` | `0s` | `2s` |
| `server.idle_timeout` | `60s` | `0` (never) |

A value the configuration sets outranks either default.
`events.retention.trigger_secret` has no default, because a secret has none:
it stays required for the purge.

### 4. The cloud's launcher states the fact and nothing else

The launcher sets `NEXTGEN_SERVER_REQUEST_BOUND=true` for a deployment and no
longer sets the settings that follow from it. A local run keeps running, so
it does not.

## Rejected

- **A "serverless mode".** A mode is a list of behaviors under one name; the
  list grows with every incident and nobody can say what the name promises.
- **Documenting the three settings.** That leaves every operator, and every
  new background task, to rediscover the problem.
- **Detecting the platform.** `VERCEL` could be read, but how Cloud Run
  allocates CPU is not visible to the process.
- **Running the purge, the shipper or the ping inside whatever request comes
  next.** It adds their latency to a user's request and does nothing without
  traffic.
- **Triggers for the shipper and the ping now.** Neither runs on the cloud
  yet. Each gets a trigger when it has to; until then the start says so.

## Consequences

- A request-bound deployment needs a scheduler for the purge, or retention
  off.
- A rotation's re-wrap delays the first request of each start while the
  previous key is configured, and a start with one key no longer lists every
  key.
- The group and the lint cover the server's own code. Goroutines inside
  libraries, such as the OpenTelemetry exporters' batch timers and the pgx
  pool's health check, stay their settings' business.
- [ADR 065](065-background-jobs.md)'s job loop is a task like the others: it
  needs a trigger, or it is unsupported.
