# Cell hierarchy POC

Prove multi-cell site hierarchy and lookup float-up — not an IAM admin console.

## Mental model

```text
hoster:  platform PROJECT (teams / ops — not customer user lookup)
           └── team per customer (e.g. acme)

customer:  workspace = FIRST site/project on a chosen cell
             linked to customer team via customer_team_id (tuple / breaking-glass deferred)
             NO project-parent attach to platform
           expand: add CHILD site on another cell
             parent_project = chosen parent site (workspace root or intermediate)
             lookup walks UP site-only: US-2-1 → US-2 → acme (workspace root)
             never floats to platform
```

Rules:

- All objects live in **one cell only**.
- Parent site’s lookup table holds floated keys from children (float-up).
- **Lookup parent chain is site-only** — never platform. Platform holds teams/ops, not customer user lookup rows.
- **Lookup walk is delegated up parent sites**: the UI (or any client) POSTs `/v1/lookup/walk` once to the entry cell; that cell resolves locally, then HTTP-calls its parent’s `/v1/lookup/walk`, and so on to the root. The response `trace` is the authoritative UI → entry → … → root chain (not a client fan-out to every cell).
- Workspace ↔ customer team = `customer_team_id` (tuple binding deferred).
- **Users + lookup only** for now (apps / grants / interests / tuples / groups deferred).
- Restart proof: create user on a child site → float to parent sites → lookup from sibling finds home via site chain.

## UI

The console is a **client-rendered SPA** (`internal/ui/web/`). The Go UI process serves `index.html` for primary routes and a JSON API under `/api/v1/*`. Open DevTools → Network and filter XHR/fetch: you should see `/api/v1/...` calls, not full HTML document navigations on Cells / Platform / Workspaces / Project actions. An in-app **Requests** panel logs each SPA `fetch` (method, path, status, duration).

**CORS / direct cell calls:** the browser never talks to docker cell hostnames. All browser traffic stays on the UI origin (`/api/...`). Nested cell→cell lookup walks remain server-side; the Latest hop timeline still shows us-1→us-2→eu-1 from the API response `timeline` / trace.

| Nav | Role |
|---|---|
| **Cells** `/` | Ops: platform membership tree + join spare (platform API only; manual refresh) |
| **Platform** `/platform` | Hoster: platform project + create/list customer teams |
| **Workspaces** `/workspaces` | Customer: list root sites; create workspace (= first site) |

- **Create workspace** requires cell + customer team → creates the project (`workspace_id` = self, `lookup_enabled=true`, **empty parent** — not attached to platform) → client navigates to `/projects/{id}`.
- **Child sites** attach to a **parent site** (workspace root or intermediate) so keys float within the customer site tree only.
- **Site page** `/projects/{id}`: meta, child sites, create user, lookup-from-here, delete user (tombstone), add child site (parent picker), **Latest hop** inline (from mutating JSON `timeline`).
- **Cell detail** `/cells/{label}`: per-cell me / children / projects (loaded only when you open that cell).
- No Lab. `/lab` and `/scenarios` redirect to `/workspaces`.
- No sticky Global Trace drawer. Latest action hops render inline on the page that ran the action.

## Topology

```text
platform (parent cell)     port 8100
├── eu-1  EU · Frankfurt   port 8101
├── eu-2  EU · Lisbon      port 8102
├── us-1  US · Iowa        port 8103
└── us-2  US · San Francisco port 8104
spare (unjoined)           port 8105
```

Cell membership tree (eu-1 joins platform as a **cell**) is separate from the **site/project** tree. Workspace roots are not project-children of platform; child sites attach only to parent sites.

Cells `/` contacts **only the platform cell** (`GetMe` + `/v1/children`). Leaf cell detail lives under `/cells/{label}`. Project trees belong on Workspaces / site pages.

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

Bootstrap: joins (leaves → platform **as cells**) then `scripts/bootstrap-projects.sh`  
→ platform project + team `acme` + workspace/site `acme` on eu-1 (**no** project attach to platform).

After pulling model changes, wipe local DBs so old floated platform lookup rows disappear:

```bash
rm -rf .local/data .local/*.db
```

### Demo script

1. Open `/projects/acme` → **Create user** `joe@example.com` (local + floats only if parents exist; root has none → stays on acme).
2. **Add child site** e.g. `acme-us2` on `us-2`, parent = `acme`.
3. On `/projects/acme-us2` → create another user or **Lookup** `joe@example.com` → hit via site parent chain (not platform).
4. Optionally add `acme-us2-1` under `acme-us2` and lookup from there.

## Deferred

- Apps, grants, interests, tuples, group expand / cross-cell FGA
- Global login / sign-in flows
- Breaking-glass via team tuple
- Region aggregator cells

Cell APIs for apps/tuples/FGA remain; the UI does not surface them.

## Locked decisions

- Cell tree = membership only; site/project tree is separate.
- Lookup floats on PROJECT parents only; never walks children; never onto platform for customer workspaces.
- Lookup provenance: `source=local|child`, `via_project` = child project id when floated.
- `customer_team_id` on projects links a site to its hoster team (tuple binding later).

## Tests

```bash
cd pocs/cell-hierarchy && go test ./...
```
