/**
 * MSW handlers for the Zitadel platform API used by the CLI.
 *
 * Covers: /projects, /schemas, /flow_definitions, /capabilities,
 * /projects/:id/claim/init, /projects/:id/claim/status.
 *
 * Usage (Node / vitest):
 *
 *   import { setupServer } from 'msw/node';
 *   import { setupPlatformHandlers, resetPlatformStore } from '@zitadel-nextgen/api-mock/platform';
 *
 *   const server = setupServer(...setupPlatformHandlers());
 *   beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
 *   afterAll(() => server.close());
 *   afterEach(() => { server.resetHandlers(); resetPlatformStore(); });
 */
import { randomUUID } from "node:crypto";

import { http, HttpResponse } from "msw";

function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function nowIso(): string {
  return new Date().toISOString();
}

type Project = {
  id: string;
  projectSecret: string;
  previewSecret: string;
  previewOrigins: string[];
  createdAt: string;
  updatedAt: string;
  configVersion: number;
  challengeId?: string;
};

type ClaimState = "pending" | "claimed" | "expired";

type Store = {
  projects: Map<string, Project>;
  schemas: Map<string, object>;
  flowDefinitions: Map<string, object>;
  claimState: ClaimState;
};

function makeStore(): Store {
  return {
    projects: new Map(),
    schemas: new Map(),
    flowDefinitions: new Map(),
    claimState: "pending",
  };
}

let store: Store = makeStore();

/** Reset all in-memory state between tests. */
export function resetPlatformStore(): void {
  store = makeStore();
}

/** Advance the claim status to "claimed" — call this in tests that exercise the claim flow. */
export function completeMockClaim(): void {
  store.claimState = "claimed";
}

export function setupPlatformHandlers() {
  return [
    // GET /capabilities
    http.get("*/capabilities", () =>
      HttpResponse.json({
        mode: "mock",
        version: nowIso().slice(0, 10),
        features: { browser_bootstrap: true, preview_secrets: true, config_apply: true },
      }),
    ),

    // POST /projects
    http.post("*/projects", async ({ request }) => {
      const body = (await request.json()) as { previewOrigins?: string[] };
      const id = `proj-${shortId()}`;
      const createdAt = nowIso();
      const project: Project = {
        id,
        projectSecret: `sk_proj_${id.replace(/-/g, "")}_full`,
        previewSecret: `sk_proj_${id.replace(/-/g, "")}_preview`,
        previewOrigins: body.previewOrigins ?? [],
        createdAt,
        updatedAt: createdAt,
        configVersion: 0,
      };
      store.projects.set(id, project);
      return HttpResponse.json(
        {
          id: project.id,
          projectSecret: project.projectSecret,
          previewSecret: project.previewSecret,
          previewOrigins: project.previewOrigins,
          createdAt: project.createdAt,
        },
        { status: 201 },
      );
    }),

    // GET /projects/:id
    http.get("*/projects/:id", ({ params }) => {
      const project = store.projects.get(params.id as string);
      if (!project) return HttpResponse.json({ error: "not_found" }, { status: 404 });
      return HttpResponse.json({
        id: project.id,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      });
    }),

    // PUT /projects/:id/config
    http.put("*/projects/:id/config", async ({ params, request }) => {
      const project = store.projects.get(params.id as string);
      if (!project) return HttpResponse.json({ error: "not_found" }, { status: 404 });
      const body = (await request.json()) as { hash?: string };
      project.configVersion += 1;
      project.updatedAt = nowIso();
      return HttpResponse.json({
        config_version: project.configVersion,
        hash: body.hash ?? "",
        applied_at: project.updatedAt,
        server_capabilities: {
          schema_version: "2.0",
          flow_protocol_version: "1.0",
          step_types: ["identifier", "credential", "form", "verification", "redirect", "info", "complete"],
          idp_types: ["oidc"],
          delivery_modes: ["dev_inbox"],
          renderer_modes: ["default"],
          features: ["preview_secrets", "capability_handshake_v1"],
        },
        warnings: [],
      });
    }),

    // POST /projects/:id/claim/init
    http.post("*/projects/:id/claim/init", ({ params }) => {
      const projectId = params.id as string;
      const challengeId = `chal_${shortId()}`;
      const project = store.projects.get(projectId);
      if (project) project.challengeId = challengeId;
      return HttpResponse.json({
        claim_url: `https://zitadel.cloud/claim/${projectId}/${challengeId}`,
        challenge_id: challengeId,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
    }),

    // GET /projects/:id/claim/status
    http.get("*/projects/:id/claim/status", ({ params }) => {
      const project = store.projects.get(params.id as string);
      if (store.claimState === "claimed") {
        return HttpResponse.json({
          status: "claimed",
          new_project_secret: `${project?.projectSecret ?? "sk"}_claimed`,
          team_id: "team_mock",
          claimed_at: nowIso(),
          dashboard_url: `https://zitadel.cloud/projects/${params.id as string}`,
          tier: "free",
        });
      }
      return HttpResponse.json({ status: store.claimState });
    }),

    // POST /schemas
    http.post("*/schemas", async ({ request }) => {
      const body = (await request.json()) as object;
      const id = `schema_${shortId()}`;
      store.schemas.set(id, body);
      return HttpResponse.json({ id }, { status: 201 });
    }),

    // GET /schemas/:id
    http.get("*/schemas/:id", ({ params }) => {
      const schema = store.schemas.get(params.id as string);
      if (!schema) return HttpResponse.json({ error: "not_found" }, { status: 404 });
      return HttpResponse.json(schema);
    }),

    // DELETE /schemas/:id
    http.delete("*/schemas/:id", ({ params }) => {
      store.schemas.delete(params.id as string);
      return new HttpResponse(null, { status: 204 });
    }),

    // POST /flow_definitions
    http.post("*/flow_definitions", async ({ request }) => {
      const body = (await request.json()) as object;
      const id = `flow_${shortId()}`;
      store.flowDefinitions.set(id, body);
      return HttpResponse.json({ id }, { status: 201 });
    }),

    // PATCH /flow_definitions/:id
    http.patch("*/flow_definitions/:id", async ({ params, request }) => {
      if (!store.flowDefinitions.has(params.id as string))
        return HttpResponse.json({ error: "not_found" }, { status: 404 });
      const body = (await request.json()) as object;
      store.flowDefinitions.set(params.id as string, body);
      return new HttpResponse(null, { status: 204 });
    }),

    // DELETE /flow_definitions/:id
    http.delete("*/flow_definitions/:id", ({ params }) => {
      store.flowDefinitions.delete(params.id as string);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
