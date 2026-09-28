# Performance Acceptance Criteria

This page says what "fast enough" means for nextgen. It is the one place where
the performance targets live. The benchmark tooling
([#1094](https://github.com/zitadel/nextgen/issues/1094)) produces the numbers;
this page decides what they have to be.

Why it is set up this way: [ADR 066](../adrs/066-performance-acceptance-criteria.md).
Test results: [`runs/`](runs/). Template for a test run:
[`acceptance-template.md`](acceptance-template.md).

The first half of this page is written for everyone. The
[technical detail](#technical-detail) starts further down, and you can stop
reading there if you only need the overview. Words that may be unfamiliar are
explained in the [glossary](#glossary) at the end.

## Where we are today

**Most of the tables on this page are empty, and that is on purpose.** We have
not measured nextgen yet, so we don't know what numbers are realistic. Instead of
guessing, we first measure, and then set the targets based on what we measured.

The first step (phase P0) has no performance target at all. It only asks: can we
measure nextgen in a way that gives the same result twice?

## Phases

We work in four phases. Each phase asks one question and has one pass/fail check
(a _gate_). A phase must pass before the next one starts.

The phases belong to this page only. They are **not** GitHub milestones and are
not linked to the product roadmap. Linking them is a product decision, and we
left it open on purpose (see
[ADR 066, Consequences](../adrs/066-performance-acceptance-criteria.md#consequences)).

| Phase  | Question                                 | Passes when                                                                                                                 |
| ------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **P0** | Can we measure this at all, reliably?    | **Everything is measured and labeled.** Two runs of the same test differ by less than 10%. No speed target.                 |
| **P1** | Is anything badly broken?                | Easy targets on the smallest server size. The system handles a steady load for 30 minutes without slowing down.             |
| **P2** | Does it get faster when we add hardware? | **Doubling the hardware gives at least 1.6× the capacity** (80% of a perfect doubling). Response times are not checked yet. |
| **P3** | Is it ready to launch and to publish?    | Firm response-time targets, a published error budget, cost per 1000 requests, long-running and spike tests.                 |

P0 is the phase that matters today. It needs no guessing: it passes once we have
a complete, labeled measurement that we can repeat. All P1 targets are then
calculated from those measurements.

## Test setups: one per database

nextgen supports three databases. We test each one in its own setup. The setups
are identical except for the database
([#1097](https://github.com/zitadel/nextgen/issues/1097)).

| Setup          | What it tells us                                                                                                                                     | What it does **not** tell us                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SQLite**     | How much work one request costs. Very stable, so it is great for spotting slowdowns early.                                                           | How many requests per second nextgen can handle. SQLite handles one request at a time by design ([why](../adrs/066-performance-acceptance-criteria.md#sqlite-handles-one-request-at-a-time)). |
| **PostgreSQL** | What most customers will see.                                                                                                                        |                                                                                                                                                                                               |
| **Spanner**    | How nextgen behaves when spread over many machines. Some known problems live here already ([#1011](https://github.com/zitadel/nextgen/issues/1011)). |                                                                                                                                                                                               |

Because of this, an SQLite number is never shown next to a PostgreSQL or Spanner
number, and SQLite is not part of the "does it scale" test in P2.

## Server sizes

To check whether nextgen gets faster with more hardware, we run the same test on
a small server, then double it, and double it again.

| Size | PostgreSQL       | Spanner             | What doubling tests                                                                 |
| ---- | ---------------- | ------------------- | ----------------------------------------------------------------------------------- |
| base | 2 vCPU / 8 GiB   | _(measured in P1)_  | —                                                                                   |
| ×2   | 4 vCPU / 16 GiB  | ×2 processing units | PostgreSQL: can one bigger machine do more? Spanner: does the data spread out well? |
| ×4   | 8 vCPU / 32 GiB  | ×4 processing units |                                                                                     |
| ×8   | 16 vCPU / 64 GiB | ×8 processing units |                                                                                     |

`8 vCPU / 32 GiB` is the PostgreSQL size used today for current Zitadel. Here it
is the ×4 size, not the starting point. nextgen stores data in a different way
than current Zitadel, so we should not assume it needs the same hardware. That
is something to measure, not to copy.

**The Spanner base size is measured, not guessed.** Spanner capacity is sold in
"processing units", which cannot be converted to CPUs. So in P1 we look for the
Spanner size that handles the same load as the 2 vCPU PostgreSQL server, and
start from there. Until then, Spanner and PostgreSQL results cannot be compared
with each other.

## What we measure

- **Response time**, for each type of request separately. Always stated together
  with the load it was measured at.
- **Capacity**: the highest steady load at which response times stay within
  their target.
- **Scaling**: how much capacity grows when the hardware doubles.
- **Errors**: server errors, client errors and failed checks, counted separately
  because different teams fix them.
- **Missed requests**: requests the test tool could not send on time. Any number
  above zero fails the test.
- **Cost per 1000 requests**, based on the cloud list price, with the
  calculation shown.

The exact definitions are in the [technical detail](#metric-definitions).

## How to read a number on this page

Every number says where it came from. The label is part of the number:

| Looks like                        | Meaning                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `—`                               | Not measured yet, no target yet. This is what most of the page looks like today.  |
| `~1000` _(assumed)_               | A guess, clearly marked as one, with the reasoning in a footnote. Never a target. |
| `825` _(measured, `runs/<file>`)_ | Comes from a test result stored in [`runs/`](runs/).                              |
| `≥ 660` _(gate P2)_               | A target, calculated from a measured number in the phase before.                  |

**An empty cell is fine. A number copied from an older test is not.** If we can't
point to the test result a number came from, it doesn't go on this page. And a
target may only be calculated from a measured number, never from a guess.

## When the tests run

| Setup      | How often          | Why                                                                                                                                                                 |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite     | on every merge     | Cheapest to run, and the most stable, so it catches slowdowns early. Once a speed is measured, later merges may not be slower than that, apart from a small margin. |
| PostgreSQL | weekly             |                                                                                                                                                                     |
| Spanner    | weekly             |                                                                                                                                                                     |
| All sizes  | at each phase gate |                                                                                                                                                                     |

How the tests are scheduled is handled in
[#1113](https://github.com/zitadel/nextgen/issues/1113). The target values
themselves stay on this page.

## Using these targets in an API issue

An API issue links to this page. It does not copy a number:

> Meets the **P2** target for its request type in
> [`docs/performance/README.md`](README.md).

A copied number gets out of date. With a link, we change the target in one
place and every issue follows.

---

## Technical detail

_Everything below is for engineers building or running the tests. Product
readers can stop here; the [glossary](#glossary) is at the very end._

### Request types

Response times are checked per request type, never as one number for
everything. A single overall target either passes too easily or fails because
of a correct default setting.

| Type         | Operations                                                                                                                          | Note                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `probe`      | `GET /healthz`                                                                                                                      | No login, no audit row. The baseline: shows the cost of the HTTP layer alone. |
| `read-point` | `getSession` `GetUserByID` `getMyUser` `getMySession` `getAuthAttempt`                                                              |                                                                               |
| `read-query` | `querySessions` `queryUsers` `listUserTeams` `listUserPasskeys`                                                                     | Paged with cursors ([ADR 027](../adrs/027-cursor-based-pagination.md)).       |
| `write`      | `createSession` `createUser` `revokeSession` `revokeMySession` `DeleteUserByID` `createAuthAttempt`                                 |                                                                               |
| `flow-step`  | `createFlow` `getFlowStep` `submitFlowStep` (steps without a credential)                                                            |                                                                               |
| `credential` | `setUserPassword` `submitFlowStep` (password) `beginUserPasskeyRegistration` `finishUserPasskeyRegistration` `verifyChallengeProof` | **Limited by memory, see below.**                                             |
| `handoff`    | `exchangeHandoff` `createHandoff` `issueChallenge`                                                                                  |                                                                               |

#### The `credential` type is limited by memory, not CPU

The password hasher defaults to argon2id with `time: 3`, `memory: 65536` KiB,
`threads: 4`. That is the right default and not a bug. But it means every
password check in progress uses 64 MiB of memory. How many can run at once
depends on the server's memory, so a load test on a login flow is really
measuring RAM.

**Every published `credential` number states the hasher settings next to it**,
otherwise it means nothing. The target for this type is calculated from memory,
not guessed.

#### Every other type writes to the database

`internal/audit` writes one `request.api` event per API request
([ADR 048](../adrs/048-wide-events-internal-audit-primitive.md), Path A). Only
`/healthz` is skipped. So **no endpoint is read-only in the database**, and a
target that assumes reads are cheap will be wrong on every setup.

### Metric definitions

| Metric                           | Definition                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Latency**                      | p50 / p95 / p99 per request type, measured at a **fixed arrival rate**, and stated with that rate. A p95 without its load is not a measurement.                                               |
| **Throughput within budget** `T` | The highest steady arrival rate at which the p95 of a request type stays within its target. Not the peak requests per second: a higher peak is always possible by accepting slower responses. |
| **Scaling efficiency** `E`       | `E = (T_2x / T_1x) / 2` for one doubling of server size. `E = 1.0` means capacity doubled exactly. **P2 gate: `E ≥ 0.8`.**                                                                    |
| **Error rate**                   | Counted from the raw test output, never from the log, and split into 5xx / 4xx / check failures. Each has a different owner.                                                                  |
| **Dropped iterations**           | Requests the load generator could not send at the configured rate. **Any non-zero value fails the run.**                                                                                      |
| **Cost per 1000 requests**       | Calculated at rate `T` from the setup's list price. Shows its inputs, or it is not a number.                                                                                                  |

### Load must be open-model

Load is set as a **fixed or rising arrival rate** that does not depend on how
fast the server answers. It must not come from a fixed number of virtual users
who each wait for their answer before sending the next request.

With a fixed number of waiting users (a closed model), load and response time
depend on each other: when the server slows down, the users send less. A queue
never builds up, so `T` cannot be measured. The result looks the same whether
the server is healthy or struggling.

This is a requirement on the benchmark tooling
([#1095](https://github.com/zitadel/nextgen/issues/1095),
[#1096](https://github.com/zitadel/nextgen/issues/1096)), not only on this page.

### Gate values per phase

Values stay `—` until P0 is done. What each gate checks is fixed now; the
numbers are calculated from the measurements of the phase before.

#### P0: baseline

No performance target. The gate is repeatability:

- Every cell on this page measured and labeled, on all three setups.
- Two runs of the same configuration differ by less than 10% on `T` and on p95
  per request type.
- One stored test result per setup in [`runs/`](runs/), with no empty cells.

#### P1: nothing badly broken

Base size only: PostgreSQL 2 vCPU / 8 GiB, Spanner at its measured base size.

| Check              | Value                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------- |
| p95 per type       | `< 1 s` for every type except `credential`, which gets its own target based on memory |
| Steady rate        | `≥ 100/s`, held for 30 min without response times creeping up                         |
| 5xx                | `0`                                                                                   |
| Check failures     | `< 1%`, counted from raw test output                                                  |
| Dropped iterations | `0`                                                                                   |

Intentionally easy. P1 checks that the system works under modest, realistic
load. It is not an optimization target.

#### P2: it scales

All doublings, PostgreSQL and Spanner. **Response times are not checked**:
endpoints are not expected to be optimized yet, and checking them here would
fail the phase for the wrong reason.

| Check              | Value                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Scaling efficiency | `E ≥ 0.8` for every doubling                                                                      |
| Queueing           | `p99 / p50 < 10` at rate `T`                                                                      |
| Dropped iterations | `0` at every size                                                                                 |
| SQLite setup       | Service time no slower than its recorded value, within the margin. **Not part of the size test.** |

This phase finds requests that pile up waiting on a shared lock. Its result is
the honest answer to "can nextgen handle large scale?".

#### P3: ready to launch

Firm response-time targets per request type, calculated from P2's measurements;
the capacity number that goes on a public page; a published error budget; cost
per 1000 requests per setup and size; plus a soak test (several hours, memory
use and backlogs stay stable) and a burst test (sudden jump in load, recovery time
within a limit).

## Glossary

| Term                            | Meaning                                                                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4xx / 5xx**                   | HTTP error codes. 4xx means the request was wrong (client error); 5xx means the server failed (server error).                                                                                   |
| **argon2id**                    | The method used to hash (safely store and check) passwords. It uses a lot of memory on purpose, to make password cracking expensive.                                                            |
| **Arrival rate**                | How many new requests the test sends per second, regardless of how fast the server answers.                                                                                                     |
| **Benchmark tooling / harness** | The software that generates load and records the results. Being built in [#1094](https://github.com/zitadel/nextgen/issues/1094).                                                               |
| **Boot marker**                 | A value recorded when the test starts and checked again at the end, to prove the server and its data were not reset during the run.                                                             |
| **Burst test**                  | A test where the load suddenly jumps, to see how quickly the system recovers.                                                                                                                   |
| **Check failure**               | The server answered, but the answer was not what the test expected.                                                                                                                             |
| **Dropped iteration**           | A request the load generator should have sent but could not, usually because the generator itself was overloaded.                                                                               |
| **Error budget**                | The share of requests that may fail in a period before we consider the service unhealthy.                                                                                                       |
| **Gate**                        | A pass/fail check at the end of a phase. The next phase starts only when it passes.                                                                                                             |
| **fsync**                       | Forcing data to be written to disk. On a network disk this is slow, and can end up being the main thing a test measures.                                                                        |
| **GiB**                         | Gibibyte, a unit of memory (about 1.07 GB).                                                                                                                                                     |
| **Lane**                        | The name the benchmark issues use for a test setup. There is one per database: SQLite, PostgreSQL and Spanner.                                                                                  |
| **Latency / response time**     | How long one request takes, from sending it to getting the answer.                                                                                                                              |
| **Load generator**              | The machine that sends the test requests. It must not be the machine being tested.                                                                                                              |
| **Open model / closed model**   | Two ways to create test load. Open: requests arrive at a set rate, like real users. Closed: a fixed group of simulated users, each waiting for an answer before sending again. We require open. |
| **p50 / p95 / p99**             | Percentiles. p95 = 500 ms means 95 out of 100 requests took 500 ms or less. p50 is the typical request; p99 shows the slowest ones.                                                             |
| **Processing unit**             | The unit Spanner capacity is sold in. It cannot be converted to CPUs.                                                                                                                           |
| **Regression**                  | Something that got slower (or worse) compared to an earlier version.                                                                                                                            |
| **Replica**                     | One running copy of the application. More replicas share the load.                                                                                                                              |
| **RSS**                         | How much memory a program is using right now.                                                                                                                                                   |
| **Service time**                | How long the server works on one request when nothing else is running.                                                                                                                          |
| **Smoke test**                  | A short, quick test that only checks that things work at all. Its numbers are not compared with real runs.                                                                                      |
| **Soak test**                   | A test that runs for several hours at steady load, to find slow problems like memory that is never freed.                                                                                       |
| **Throughput / capacity**       | How many requests per second the system handles.                                                                                                                                                |
| **vCPU**                        | A virtual CPU core in a cloud server.                                                                                                                                                           |
| **Virtual user (VU)**           | A simulated user in a load test.                                                                                                                                                                |
