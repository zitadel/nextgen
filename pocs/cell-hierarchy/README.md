# Cell hierarchy POC — sites & workspaces

Greenfield multi-container Go cells with SQLite membership, join/heartbeat, **sites as projects** (workspace UX metadata), user lookup float-up with **provenance**, regional apps/grants with home-cell interest registration, inspectable home-issued JWTs, resource-cell auth checks, cross-cell group Expand/Check, user block/delete with grant tombstones, workspace/site forms, Global login discovery, **pairwise inter-cell delays**, and an HTMX UI with a shared left nav and Global Trace of every PeerClient hop.

Lives under `pocs/cell-hierarchy/` as a nested Go module (not wired into Moon/CI).

## UI navigation

One shared left nav on every page:

| Section | Link | Route |
|---|---|---|
| Ops → Cells | Topology, join spare, delay matrix | `GET /` |
| Ops → Lab | Scenario demos (was Scenarios) | `GET /lab` (`/scenarios` redirects) |
| Ops → Trace | Full Global Trace | `GET /trace-view` |
| Customer → Workspaces | List/create workspaces | `GET /workspaces` |

Standalone top links for Join / Create / Tree are gone. Join lives on Cells; create workspace/site under Workspaces. Customer pages show breadcrumbs (`Workspaces / {id} / {site}`).

## Topology

### Cell tree (ops / membership)

```text
platform (parent cell, is_parent=true)     port 8100
├── eu-1  EU · Frankfurt                   port 8101
├── eu-2  EU · Lisbon                      port 8102
├── us-1  US · Iowa                        port 8103
└── us-2  US · San Francisco               port 8104
spare (unjoined)                           port 8105
```

### Sites = projects; Workspace = UX registry

Each **site** is a project on one cell. A **workspace** is name + **home_cell** metadata (no parent project). Creating a workspace does not create a site. Sites carry `workspace_id`; the UI also keeps a small registry (`.local/workspaces.json`, seeded with `acme` / home `eu-1`).

```text
platform PROJECT  [lookup ON]  ← global login / lookup zone
└── acme-fra      [workspace=acme]  hosted on eu-1
```

## Pairwise delays

The Cells page edits a delay matrix (ms). Defaults:

| Pair | ms |
|---|---|
| eu-1 ↔ eu-2 | 20 |
| eu-1 ↔ us-1 | 100 |
| eu-1 ↔ us-2 | 200 |
| eu-2 ↔ us-1 | 150 |
| eu-2 ↔ us-2 | 250 |
| us-1 ↔ us-2 | 10 |

Same-cell = 0. Both labels known but pair unset = 0. Either side unlabeled = 50ms. Saving posts to the UI and broadcasts `POST /v1/admin/delays` to every cell so cell-to-cell peer hops sleep the same matrix. Lab no longer has a flat delay slider.

## Global Trace

`PeerClient.OnHop` fires after every outbound HTTP (success or fail). The UI sets `Peer.OnHop` and wraps mutating handlers with `beginTrace` / `endTrace` (or `appendTrace`, which drains the OnHop buffer). Server-returned `Trace` arrays (CreateUser float, FGA, AuthCheck, DeleteUser, …) are still merged in. Background page polls without `beginTrace` stay silent.

## Quick start

```bash
cd pocs/cell-hierarchy
./scripts/run-local.sh
# or: docker compose up --build
```

| Surface | URL |
|---|---|
| UI (Cells) | http://localhost:3000 |
| Workspaces | http://localhost:3000/workspaces |
| Lab | http://localhost:3000/lab |
| Trace | http://localhost:3000/trace-view |
| Cells API | http://localhost:8100–8105 |

Bootstrap: joins (all leaves → platform) then `scripts/bootstrap-projects.sh`.

## Project overview CRUD

Day-to-day resource management lives on **`/projects/{id}`** with breadcrumbs back to the workspace. Mutations append to Global Trace (outbound hops + server Trace).

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

Covers: PeerClient OnHop, pairwise delay sleep, admin delays broadcast, workspace create + add site, plus prior join/auth/FGA/site coverage.
