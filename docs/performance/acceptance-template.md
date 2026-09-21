# Acceptance run — template

Copy to `runs/<YYYY-MM-DD>-<lane>-p<phase>.md` and fill it in. Targets for the
phase are copied in from [`README.md`](README.md) **before** the run; measured
columns start empty and stay empty until there is a file to trace them to.

Do not delete rows that do not apply — mark them `n/a` with a reason. A missing
row reads as an oversight; an explicit `n/a` reads as a decision.

---

# P&lt;phase&gt; · &lt;lane&gt; · &lt;rung&gt; · &lt;date&gt;

**Verdict: PASS / FAIL / INCOMPLETE** — one line, stating which gate and why.

## Preflight

Every box before the first measured request. Capturing configuration after a run
is how a sweep turns out to have measured something other than what it is
compared against.

- [ ] Run mode stated explicitly (local / separated). Unset is a refusal, not a default
- [ ] **The load generator is not the machine under test.** Co-located runs are smokes, are labeled as such, and are never compared against a separated run
- [ ] Git SHA of the server build recorded
- [ ] Dialect and engine version recorded
- [ ] Replica count recorded; SQLite lane is `min = max = 1`
- [ ] Password hasher parameters recorded (bounds the `credential` class)
- [ ] Log level and format recorded
- [ ] Feature flags / anything selecting a code path recorded
- [ ] Storage type recorded (local volume vs network-attached — the latter makes `fsync` the measurement)
- [ ] Boot marker captured, to be re-checked at the end
- [ ] Audit retention sweep window recorded or disabled
- [ ] Price inputs recorded (currency per hour, per component)
- [ ] Load generator resource baseline recorded (RSS, CPU)
- [ ] Executor is **open-model** (arrival rate), not a fixed virtual-user pool

## Environment

| | |
| --- | --- |
| Phase | |
| Lane | SQLite / PostgreSQL / Spanner |
| Rung | e.g. `4 vCPU / 16 GiB`, or processing units |
| Server git SHA | |
| Engine version | |
| App replicas | |
| Storage | |
| Hasher | `argon2id time=? memory=? KiB threads=?` |
| Log level / format | |
| Run mode | local / separated |
| Generator host class | |
| Boot marker (start) | |
| Boot marker (end) | |
| Duration | |
| Raw sample artifact | path, and whether it still exists |

## Latency and throughput

One row per operation class. Every measured value states the arrival rate it was
measured at.

| Class | Rate | Target p95 | p50 | p95 | p99 | Source | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `probe` | | | | | | | |
| `read-point` | | | | | | | |
| `read-query` | | | | | | | |
| `write` | | | | | | | |
| `flow-step` | | | | | | | |
| `credential` | | | | | | | |
| `handoff` | | | | | | | |

**Throughput at SLO** — highest sustained arrival rate holding the class p95
budget:

| Class | `T` (req/s) | Budget held | Source |
| --- | --- | --- | --- |
| | | | |

## Scaling — P2 gate

PostgreSQL and Spanner only. **The SQLite lane is not laddered**; delete this
section on a SQLite record and record the service-time floor below instead.

| Rung | `T` at SLO | `E` vs previous | Target `E` | p99/p50 | Dropped iterations | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| base | | — | — | | | |
| ×2 | | | ≥ 0.8 | | | |
| ×4 | | | ≥ 0.8 | | | |
| ×8 | | | ≥ 0.8 | | | |

### SQLite lane only — service-time floor

| Class | Service time (1 concurrent) | Floor | Tolerance | Verdict |
| --- | --- | --- | --- | --- |
| | | | | |

## Errors

Counted from the raw sample output, not from the log. The log tells you a class
of failure exists; only the raw output tells you how much of it there was.

| Population | Count | Rate | Budget | Source | Verdict |
| --- | --- | --- | --- | --- | --- |
| 5xx | | | | | |
| 4xx | | | | | |
| Check failures | | | | | |
| Dropped iterations | | | `0` | | |

A structural-looking failure rate — a round split, or exactly one check's worth
per iteration — is the harness, not the server. Say which before publishing
either.

## Cost

| | Inputs | Value |
| --- | --- | --- |
| Database | per hour × duration | |
| Application | per hour × duration | |
| Cost per 1000 requests | total ÷ (requests ÷ 1000) | |

## Run validity

Tick what happened. Any unticked box under *Invalidating* means the run is
reported, not compared.

**Non-invalidating**

- [ ] Setup aborted before the measurement window — surrounding runs remain valid
- [ ] Known harness defect, described, affecting a named class only

**Invalidating**

- [ ] Boot marker changed between start and end (the dataset is not the one the run started against)
- [ ] Generator resource exhaustion during the measurement window
- [ ] Retention sweep landed inside the window
- [ ] Co-located generator and server
- [ ] Configuration captured after the run rather than before

## Notes and corrections

Anything corrected by hand, with the reason. What went wrong, described
accurately — including the parts that make the harness look bad, which are the
ones worth writing down.
