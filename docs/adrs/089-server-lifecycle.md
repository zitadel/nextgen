# ADR 089: The Server's Lifecycle

> **Status:** Implemented
> **Date:** 2026-11-11
> **Builds on:** [ADR 048](048-wide-events-internal-audit-primitive.md)
> (request events wait for their write) and
> [ADR 001](001-server-cli-cobra-viper.md) (configuration).
> **Amends:** [ADR 049](049-events-api-retention-export.md): the purge's own
> trigger becomes the server's wake-up endpoint (§5).
> **Related:** [ADR 065](065-background-jobs.md) (a job loop is background
> work like any other).

## Context

What the server does outside a request (a timer, a flusher, work at start)
depends on what the platform does with the process between requests:

- Docker, a VM and Kubernetes keep it running, and an instance is always up.
- Knative, and Cloud Run with CPU always allocated, keep it running while
  requests come, stop the last instance when none do and start one for the
  next request.
- A Vercel function, and Cloud Run by default, pause it between requests.
  Work left for after a response runs at the next request, or never.

The hosted cloud runs as Vercel functions and met the pause three times, one
incident each, and got one setting each: `events.retention.trigger_secret` (a
cron call replaces the purge's timer), `events.request.flush_wait` (a request
waits for its audit event) and `server.idle_timeout` `0` (a connection the
proxy reuses is not closed by a timer that expired during the pause). The
cloud's launcher set all three by name. A self-hoster on such a platform has
to find the same three, and the rest of the background work had no answer at
all: the export shipper, the service ping and the master-key re-wrap at start.
Nothing made the next background task answer either.

## Decision

### 1. One setting that states the fact

`server.lifecycle` (`NEXTGEN_SERVER_LIFECYCLE`) says how the platform keeps
the process running. A value it does not take fails the start.

| Value | Between requests the process | With no request for a while |
| --- | --- | --- |
| `always_on` (default) | runs | an instance stays up |
| `scale_to_zero` | runs | the last instance is stopped |
| `request_only` | is paused | the instance stays paused, or is stopped |

An operator picks the value with two questions. Does the platform give the
process CPU after a response is sent? If not, `request_only`. Otherwise, can
it stop the last instance? If so, `scale_to_zero`, else `always_on`.

The values describe the process, not the platform, because one platform can
be any of them: Cloud Run is `request_only` by default, `scale_to_zero` with
CPU always allocated, and `always_on` with a minimum of one instance as well.

It is a fact about where the server runs, not a mode. It names no behavior
and turns nothing on; each part of the server draws its own conclusion from
it. The settings that exist stay the mechanism.

### 2. Every background task says what it does in each

Background work starts through `internal/background`. Always on, a task
starts its loop. For each of the other two values it declares one answer:

- **While up.** The loop does the job where instances come and go, because
  the task works as an instance starts or continues from what is stored. It
  is no answer for `request_only`, where no timer runs.
- **In a request.** The work is done while a request is served: a request
  waits for it, or the server does it before it takes its first request.
- **On a wake-up.** The task keeps no timer. Its work runs once per call
  that wakes the server (§5), and the start fails while no secret opens that
  endpoint.
- **Unsupported.** The start fails while the task is on, with an error that
  names the task and the setting that turns it off.

A task that leaves a value without an answer fails the start in every
lifecycle, so the gap shows on a developer's machine. The `backgroundlint`
analyzer (`server:lint`) reports a goroutine started anywhere else, unless a
`//background:allow <reason>` comment names its task or says why it is not
background work.

| Task | `scale_to_zero` | `request_only` |
| --- | --- | --- |
| Request audit events (flusher) | While up: writes after the response, and a stop drains it | In a request: `events.request.flush_wait`; the start fails when it is `0` |
| Event retention (purge) | While up: purges as an instance starts, then on its timer | On a wake-up: one purge per call |
| Event export (shipper) | While up: ships from the stored cursor | On a wake-up: one round per call, from the stored cursor |
| Service ping | Unsupported: it pings at each start, which would count starts | Unsupported: a call cannot tell whether the deployment pinged in this interval |
| Master-key re-wrap | While up: beside the requests, again at the next start if stopped first | In a request: before the first one |

The re-wrap is on only while a previous key is configured.

No task may silently never run.

### 3. The settings a pause changes take their defaults from it

| Setting | `always_on`, `scale_to_zero` | `request_only` |
| --- | --- | --- |
| `events.request.flush_wait` | `0s` | `2s` |
| `server.idle_timeout` | `60s` | `0` (never) |

A value the configuration sets outranks either default.
`server.wake_up.secret` (§5) has no default, because a secret has none: it
stays required for periodic work where the process is paused.

### 4. The cloud's launcher states the fact and nothing else

The launcher sets `NEXTGEN_SERVER_LIFECYCLE=request_only` for a deployment and
no longer sets the settings that follow from it. A local run keeps running,
so it does not. The secret of the cloud's one cron job becomes
`server.wake_up.secret`.

### 5. One call wakes the server for all its periodic work

Where no timer runs, a scheduler outside the process does the timer's job.
It needs one entry, whatever the server's periodic tasks are:

- `server.wake_up.secret` opens `/cron/wake-up`. A `GET` or `POST` that
  carries the secret as a bearer token runs one round of every periodic task
  that is on, one after the other, and answers which succeeded: 200, or 500
  when one failed. Any other request to the path gets 401. Without the
  secret the server has no such endpoint.
- A periodic task is a task with a round (`Task.Once`): the purge and the
  export. A new one joins the call by having a round; it needs no endpoint,
  secret or cron entry of its own.
- The call runs the rounds in every lifecycle. Where the process is paused
  nothing else does. Where instances come and go, a deployment with no
  request has no instance to run a timer: the call starts one, and because
  the rounds are done when it is answered, the platform does not stop the
  instance under them. Always on, the timers run as well, and a round waits
  for one the same process is already running.
- The rounds of one call share 4½ minutes, under the five a Vercel function
  runs by default. What does not fit is cancelled and reported as failed: a
  purge then deletes nothing, and the export ships the rest with the next
  call, starting at a project picked per call so that the same ones are not
  left every time.
- A call reaches one instance, so one call runs each round once. The
  scheduler's cadence is the tasks' cadence: the export ships as often as the
  server is woken.
- The path is the operator's, not the API's: it is not in the OpenAPI
  document and takes no API credential.

It replaces `events.retention.trigger_secret` and `/cron/events-retention`
([ADR 049](049-events-api-retention-export.md)), which ran the purge alone
and turned the purge's timer off wherever the secret was set. Whether a
timer runs is now the lifecycle's alone.

## Rejected

- **A "serverless mode".** A mode is a list of behaviors under one name; the
  list grows with every incident and nobody can say what the name promises.
- **A boolean for the pause.** It has no value for a platform that runs the
  process between requests and still stops the last instance, as Knative
  does: a timer works there, and a ping at each start does not.
- **Platform names as values.** One platform is several lifecycles, and the
  list would never be complete.
- **Documenting the three settings.** That leaves every operator, and every
  new background task, to rediscover the problem.
- **Detecting the platform.** `VERCEL` and `K_SERVICE` can be read, but they
  do not say how Cloud Run allocates CPU or whether Knative may stop the last
  instance, which is what the values differ in.
- **An endpoint and a secret per task.** The purge had its own. Every further
  periodic task would have added a cron entry to every deployment that pauses.
- **Waking the service ping.** The ping's interval is longer than a
  scheduler's, so a call would have to know when the deployment last pinged,
  and nothing stores that. Pinging per call would count calls.

## Not decided here

- **Requests that run what is due.** A server could do its periodic work
  inside the requests it serves anyway and need no scheduler at all. Every
  instance serves requests, so that needs "once per interval across
  instances", which is [ADR 065](065-background-jobs.md)'s lease. The same
  stored "last run" would let a wake-up run the service ping.
- **A hint at start.** A server that finds `VERCEL` or `K_SERVICE` in its
  environment with `server.lifecycle` unset could say so, or refuse to start.

## Consequences

- A `request_only` deployment needs a scheduler with one entry, or retention
  and the export off.
- A `scale_to_zero` deployment that gets no request has no instance, so it
  purges and ships nothing until the next request starts one. With
  `server.wake_up.secret` set, a scheduler's call starts an instance and does
  both.
- The service ping stays off in both.
- A deployment that set `events.retention.trigger_secret` sets
  `server.wake_up.secret` and calls `/cron/wake-up` instead. An `always_on`
  server that used the secret to stop its own purge timer has the timer
  back.
- A sink of a type the export cannot deliver to fails the configuration's
  load, in every lifecycle, and no longer the shipper's start: paused, the
  shipper never starts.
- Where the process is paused, a rotation's re-wrap delays the first request
  of each start while the previous key is configured. A start with one key no
  longer lists every key, in any lifecycle.
- Only `request_only` on Vercel functions has run in production. What this
  ADR says about Cloud Run and Knative follows their documentation.
- How many instances run at once is not part of the setting: two instances
  purging at the same time is [ADR 065](065-background-jobs.md)'s lease to
  prevent, in every lifecycle.
- The group and the lint cover the server's own code. Goroutines inside
  libraries, such as the OpenTelemetry exporters' batch timers and the pgx
  pool's health check, stay their settings' business.
- [ADR 065](065-background-jobs.md)'s job loop is a task like the others: it
  answers for both values, or the start fails.
