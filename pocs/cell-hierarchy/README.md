# Cell hierarchy POC

Prove multi-cell architecture — not an IAM admin console.

## Proof questions

1. **Cells join under platform** — membership tree, join spare from Cells.
2. **Sites pick a cell; workspace is a label** — projects carry `workspace_id`; workspace is UX grouping only.
3. **Lookup floats up; global login finds home** — no region picker; platform project is the entry.
4. **Foreign grant + interest; delete tombstones grant** — interest fan-out; tombstone badges stay visible.
5. **Cross-cell group check hops in Trace** — OnHop + server Trace show expand hops.

## Simplified UI

| Nav | Role |
|---|---|
| **Cells** `/` | Ops: topology tree, join spare, read-only delay defaults |
| **Lab** `/lab` | Primary demo script (mutations) |
| **Trace** `/trace-view` | Global Trace of every PeerClient hop |
| **Workspaces** `/workspaces` | List/create workspace (id/name); add site (id + cell) |

- **Project `/projects/{id}`** — observe-only (users, apps, tuples with tombstones, interests, lookup provenance). No add/delete forms. Mutations happen in Lab.
- **Cells** — no delay editor; WAN delays are fixed in code and broadcast once at UI startup.
- **Lab** — numbered happy path: create joe → grant → global login → group check → delete → observe tombstones.
- Dead standalone create/join pages redirect away; cell APIs remain for Lab.

## Topology

```text
platform (parent cell)     port 8100
├── eu-1  EU · Frankfurt   port 8101
├── eu-2  EU · Lisbon      port 8102
├── us-1  US · Iowa        port 8103
└── us-2  US · San Francisco port 8104
spare (unjoined)           port 8105
```

Sites = projects on a cell. Workspace = name metadata. Lookup parent for sites is `platform`.

## Pairwise delays (fixed)

| Pair | ms |
|---|---|
| eu-1 ↔ eu-2 | 20 |
| eu-1 ↔ us-1 | 100 |
| eu-1 ↔ us-2 | 200 |
| eu-2 ↔ us-1 | 150 |
| eu-2 ↔ us-2 | 250 |
| us-1 ↔ us-2 | 10 |

Same-cell = 0. Unlisted labeled pairs = 0. Unlabeled side = 50ms. Defaults live in `DefaultPairDelays`; UI PeerClient seeds them and broadcasts `POST /v1/admin/delays` to cells at startup.

## Global Trace

`PeerClient.OnHop` fires after every outbound HTTP. Lab actions wrap with `beginTrace` / `appendTrace`. Server `Trace` arrays merge in.

## Quick start

```bash
cd pocs/cell-hierarchy
./scripts/run-local.sh
# or: docker compose up --build
```

| Surface | URL |
|---|---|
| Lab (start here) | http://localhost:3000/lab |
| Cells | http://localhost:3000 |
| Workspaces | http://localhost:3000/workspaces |
| Trace | http://localhost:3000/trace-view |
| Observe site | http://localhost:3000/projects/acme-fra |

Bootstrap: joins (leaves → platform) then `scripts/bootstrap-projects.sh`.

## Locked decisions

- Cell tree = membership only; site/project tree is separate (attach to platform).
- Lookup floats on PROJECT parents only; never walks children.
- Lookup provenance: `source=local|child`, `via_project` = child project id when floated.
- Grants live on the **resource** site cell; interests on the principal’s **home** site cell.
- Block/delete fan-out only to interest subscribers (tombstone grants; rows stay listed).

## Tests

```bash
cd pocs/cell-hierarchy && go test ./...
```

Covers: PeerClient OnHop, pairwise delay sleep, admin delays, workspace create + add site, join/auth/FGA/lifecycle/site coverage. Project UI mutations are gone — cell APIs under `/v1/...` remain.
