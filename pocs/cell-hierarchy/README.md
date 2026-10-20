# Cell hierarchy POC

Prove multi-cell site hierarchy and lookup float-up — not an IAM admin console.

## Mental model

```text
hoster:  platform PROJECT (lookup zone)
           └── team per customer (e.g. acme)

customer:  workspace = FIRST site/project on a chosen cell
             linked to that customer team (customer_team_id)
           expand: add CHILD site on another cell
             parent_project = chosen parent site (default = workspace root)
             lookup walks UP: US-2-1 → US-2 → EU-1 (first site) → platform
```

Rules:

- All objects live in **one cell only**.
- Parent site’s lookup table holds floated keys from children (float-up).
- **Users + lookup only** for now (apps / grants / interests / tuples / groups deferred).
- Restart proof: create user on a site → float to parents → lookup from sibling/child finds home via parent chain.

## UI

| Nav | Role |
|---|---|
| **Cells** `/` | Ops: topology tree, join spare, read-only delay defaults |
| **Platform** `/platform` | Hoster: platform project + create/list customer teams |
| **Workspaces** `/workspaces` | Customer: list root sites; create workspace (= first site) |

- **Create workspace** requires cell + customer team → creates the project immediately (`workspace_id` = self, `lookup_enabled=true`, attach to `platform`) → redirects to `/projects/{id}`.
- **Child sites** also enable lookup so intermediate parents can hold floated keys (US-2-1 → US-2 → EU-1 → platform).
- **Site page** `/projects/{id}`: meta, child sites, create user, lookup-from-here, delete user (tombstone), add child site (parent picker), **Latest hop** inline.
- No Lab. `/lab` and `/scenarios` redirect to `/workspaces`.
- No sticky Global Trace drawer. Latest action hops render inline on the page that ran the action. Optional `/trace-view` stays for debugging (not in nav).

## Topology

```text
platform (parent cell)     port 8100
├── eu-1  EU · Frankfurt   port 8101
├── eu-2  EU · Lisbon      port 8102
├── us-1  US · Iowa        port 8103
└── us-2  US · San Francisco port 8104
spare (unjoined)           port 8105
```

Site tree is separate from cell membership. Workspace root attaches to **platform** so keys can float into the platform lookup zone; child sites attach to a **parent site** (default = workspace root).

## Pairwise delays (fixed)

| Pair | ms |
|---|---|
| eu-1 ↔ eu-2 | 20 |
| eu-1 ↔ us-1 | 100 |
| eu-1 ↔ us-2 | 200 |
| eu-2 ↔ us-1 | 150 |
| eu-2 ↔ us-2 | 250 |
| us-1 ↔ us-2 | 10 |

Same-cell = 0. Unlisted labeled pairs = 0. Unlabeled side = 50ms.

## Quick start

```bash
cd pocs/cell-hierarchy
./scripts/run-local.sh
# or: docker compose up --build
```

| Surface | URL |
|---|---|
| Platform (teams) | http://localhost:3000/platform |
| Workspaces | http://localhost:3000/workspaces |
| Seeded site | http://localhost:3000/projects/acme |
| Cells | http://localhost:3000 |

Bootstrap: joins (leaves → platform) then `scripts/bootstrap-projects.sh`  
→ platform project + team `acme` + workspace/site `acme` on eu-1.

### Demo script

1. Open `/projects/acme` → **Create user** `joe@example.com` (floats to platform).
2. **Add child site** e.g. `acme-us2` on `us-2`, parent = `acme`.
3. On `/projects/acme-us2` → **Lookup** `joe@example.com` → hit via parent chain.
4. Optionally add `acme-us2-1` under `acme-us2` and lookup from there.

## Deferred

- Apps, grants, interests, tuples, group expand / cross-cell FGA
- Global login / sign-in flows
- Breaking-glass via team tuple
- Region aggregator cells

Cell APIs for apps/tuples/FGA remain; the UI does not surface them.

## Locked decisions

- Cell tree = membership only; site/project tree is separate.
- Lookup floats on PROJECT parents only; never walks children.
- Lookup provenance: `source=local|child`, `via_project` = child project id when floated.
- `customer_team_id` on projects links a site to its hoster team (tuple binding later).

## Tests

```bash
cd pocs/cell-hierarchy && go test ./...
```
