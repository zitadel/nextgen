# Acceptance run — template

Use this template to record one test run. Copy it to
`runs/<YYYY-MM-DD>-<lane>-p<phase>.md` and fill it in. Copy the phase's targets
from [`README.md`](README.md) **before** the run. Leave the measured columns
empty until you have a result file to point to.

Don't delete rows that don't apply. Mark them `n/a` and give a reason. A missing
row looks like something was forgotten; `n/a` shows it was a decision.

Unfamiliar words are explained in the [glossary](README.md#glossary).

---

# P&lt;phase&gt; · &lt;lane&gt; · &lt;size&gt; · &lt;date&gt;

**Verdict: PASS / FAIL / INCOMPLETE** — one line, naming the gate and the
reason. This follows from the _Verdict_ columns below: PASS only if every row
passes, INCOMPLETE if any row has no measurement. It is not a judgement call.

## Before the run

Tick every box before the first measured request. If you record the
configuration after the run, you may find out that you measured something
different from what you compare it to.

- [ ] Run mode stated (local / separated). If it is not set, don't run; don't assume a default
- [ ] **The load generator is not the machine being tested.** Runs on the same machine are smoke tests, are labeled as such, and are never compared with a separated run
- [ ] Git SHA of the server build recorded
- [ ] Database and database version recorded
- [ ] Number of app replicas recorded; for SQLite it is `min = max = 1`
- [ ] Password hasher settings recorded (they limit the `credential` type)
- [ ] Log level and format recorded
- [ ] Feature flags, and anything else that changes which code runs, recorded
- [ ] Storage type recorded (local disk or network disk; on a network disk you mostly measure `fsync`)
- [ ] Boot marker captured, to check again at the end
- [ ] Audit retention cleanup window recorded, or cleanup turned off
- [ ] Prices recorded (currency per hour, per component)
- [ ] Load generator's own resource use recorded before the run (RSS, CPU)
- [ ] Load is **open-model** (arrival rate), not a fixed number of virtual users

## Environment

|                             |                                             |
| --------------------------- | ------------------------------------------- |
| Phase                       |                                             |
| Lane                        | SQLite / PostgreSQL / Spanner               |
| Server size                 | e.g. `4 vCPU / 16 GiB`, or processing units |
| Server git SHA              |                                             |
| Database version            |                                             |
| App replicas                |                                             |
| Storage                     |                                             |
| Hasher                      | `argon2id time=? memory=? KiB threads=?`    |
| Log level / format          |                                             |
| Run mode                    | local / separated                           |
| Load generator machine type |                                             |
| Boot marker (start)         |                                             |
| Boot marker (end)           |                                             |
| Duration                    |                                             |
| Raw test output             | path, and whether it still exists           |

## Response time and capacity

One row per request type. Every measured value states the arrival rate it was
measured at.

| Type         | Rate | Target p95 | p50 | p95 | p99 | Source | Verdict |
| ------------ | ---- | ---------- | --- | --- | --- | ------ | ------- |
| `probe`      |      |            |     |     |     |        |         |
| `read-point` |      |            |     |     |     |        |         |
| `read-query` |      |            |     |     |     |        |         |
| `write`      |      |            |     |     |     |        |         |
| `flow-step`  |      |            |     |     |     |        |         |
| `credential` |      |            |     |     |     |        |         |
| `handoff`    |      |            |     |     |     |        |         |

**Throughput within budget**: the highest steady arrival rate at which the p95
of the type stays within its target:

| Type | `T` (req/s) | Target held | Source |
| ---- | ----------- | ----------- | ------ |
|      |             |             |        |

## Scaling — P2 gate

PostgreSQL and Spanner only. **SQLite is not part of the size test.** On an
SQLite record, mark every row of this table `n/a` and fill in the service-time
floor below instead.

| Size | `T` within budget | `E` vs previous size | Target `E` | p99/p50 | Dropped iterations | Verdict |
| ---- | ----------------- | -------------------- | ---------- | ------- | ------------------ | ------- |
| base |                   | —                    | —          |         |                    |         |
| ×2   |                   |                      | ≥ 0.8      |         |                    |         |
| ×4   |                   |                      | ≥ 0.8      |         |                    |         |
| ×8   |                   |                      | ≥ 0.8      |         |                    |         |

### SQLite only — service-time floor

| Type | Service time (1 request at a time) | Floor | Margin | Verdict |
| ---- | ---------------------------------- | ----- | ------ | ------- |
|      |                                    |       |        |         |

## Errors

Count errors from the raw test output, not from the log. The log tells you that
a kind of error happened; only the raw output tells you how often.

| Kind               | Count | Rate | Budget | Source | Verdict |
| ------------------ | ----- | ---- | ------ | ------ | ------- |
| 5xx                |       |      |        |        |         |
| 4xx                |       |      |        |        |         |
| Check failures     |       |      |        |        |         |
| Dropped iterations |       |      | `0`    |        |         |

If the error rate looks suspiciously regular, like a round number or exactly one
failed check per iteration, the problem is usually in the test, not the server.
Find out which one it is before publishing anything.

## Cost

|                        | Inputs                    | Value |
| ---------------------- | ------------------------- | ----- |
| Database               | price per hour × duration |       |
| Application            | price per hour × duration |       |
| Cost per 1000 requests | total ÷ (requests ÷ 1000) |       |

## Is the run valid?

Tick what happened. If any box under _Makes the run invalid_ is ticked, report
the run, but don't compare it with other runs.

**Does not make the run invalid**

- [ ] Setup failed before the measurement started; the runs before and after are still valid
- [ ] Known problem in the test tooling, described, affecting only one named request type

**Makes the run invalid**

- [ ] Boot marker changed between start and end (the data is not what the run started with)
- [ ] Load generator ran out of resources during the measurement
- [ ] Audit retention cleanup ran during the measurement
- [ ] Load generator and server ran on the same machine
- [ ] Configuration recorded after the run instead of before

## Notes and corrections

Anything corrected by hand, and why. Describe what went wrong accurately, also
the parts that make the test tooling look bad. Those are the ones most worth
writing down.
