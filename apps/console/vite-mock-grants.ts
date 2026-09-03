import type { Plugin } from "vite";

/**
 * Dev-only stand-in for `POST /grants/query`, so the Admins screen can be
 * driven before the endpoint exists.
 *
 * **Delete this file when #1118 lands**, together with
 * `src/api/grants-query.ts`. It is opt-in through `CONSOLE_MOCK_GRANTS=1` and
 * only ever installed on the dev server, so a normal `console:dev-real` run
 * still talks to the real backend and 404s the way production would.
 *
 * Only the query is intercepted. `POST /grants` and `DELETE /grants/{id}` exist
 * on the server already and keep going there, so adding and removing are
 * exercised for real — the list simply does not reflect them while this mock is
 * serving a fixed set.
 */
export function mockGrants(): Plugin | undefined {
  if (process.env.CONSOLE_MOCK_GRANTS !== "1") return undefined;

  return {
    name: "console-mock-grants",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (req.method !== "POST" || !url.startsWith("/api/grants/query")) return next();
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ grants: GRANTS }));
      });
    },
  };
}

/**
 * A roster shaped like the design's rows, plus the two cases the design does
 * not draw: a relation this screen never creates, and a grant whose principal
 * could not be loaded.
 */
const GRANTS = [
  {
    id: "asgn_mock1",
    principal_type: "user",
    principal_id: "user_mock1",
    relation: "admin",
    created_at: "2026-09-01T10:00:00Z",
    principal: { id: "user_mock1", display: "Maya Patel", identifier: "maya.patel@acme.com" },
  },
  {
    id: "asgn_mock2",
    principal_type: "user",
    principal_id: "user_mock2",
    relation: "admin",
    created_at: "2026-09-01T10:05:00Z",
    principal: { id: "user_mock2", identifier: "oscar.nguyen@acme.com" },
  },
  {
    id: "asgn_mock3",
    principal_type: "user",
    principal_id: "user_mock3",
    relation: "viewer",
    created_at: "2026-09-01T10:10:00Z",
    principal: { id: "user_mock3", display: "Sasha Kim", identifier: "sasha.kim@acme.com" },
  },
  {
    id: "asgn_mock4",
    principal_type: "user",
    principal_id: "user_deleted",
    relation: "admin",
    created_at: "2026-09-01T10:15:00Z",
    principal: null,
  },
];
