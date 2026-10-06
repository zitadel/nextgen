/**
 * The deployment log, origin allowlist and variables of the platform mock:
 * fan-out over targets, idempotency on release and frozen values, rollback,
 * the origin gate on `POST /flow`, and the `applies_to` buckets.
 */
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import { setupMockHandlers } from "./handlers.js";
import { admitFlow, resetPlatformStore, setupPlatformHandlers } from "./platform-handlers.js";

const BASE = "http://mock.test";
const server = setupServer(
  ...setupMockHandlers({ admitFlow }).handlers,
  ...setupPlatformHandlers(),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  resetPlatformStore();
});
afterAll(() => server.close());

type Json = Record<string, unknown>;

function first(body: Json): Json {
  const [row] = body.deployments as Json[];
  if (!row) {
    throw new Error("expected at least one deployment row");
  }
  return row;
}

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as Json };
}

async function newProject(allowed: { pattern: string; kind: "primary" | "preview" }[] = []) {
  const { body } = await call("POST", "/projects", {
    name: "deployments",
    allowed_origins: allowed,
    seed_defaults: true,
  });
  return body.id as string;
}

async function newRelease(projectId: string, revisionId = `sch_${Math.random().toString(36).slice(2)}`) {
  const { status, body } = await call("POST", `/releases?project_id=${projectId}`, {
    pointers: [{ kind: "schema", revision_id: revisionId }],
  });
  expect([200, 201]).toContain(status);
  return body.id as string;
}

const ACME = [
  { pattern: "https://app.acme.com", kind: "primary" as const },
  { pattern: "https://www.acme.com", kind: "primary" as const },
  { pattern: "https://*-acmeinc.vercel.app", kind: "preview" as const },
];

describe("deployments", () => {
  test("a deploy to default and primary writes one row per target under one deploy id", async () => {
    const projectId = await newProject(ACME);
    const releaseId = await newRelease(projectId);

    const { status, body } = await call("POST", `/deployments?project_id=${projectId}`, {
      release: releaseId,
      targets: ["default", "primary"],
      message: "first",
    });

    expect(status).toBe(201);
    expect(body.targets).toEqual(["", "https://app.acme.com", "https://www.acme.com"]);
    const rows = body.deployments as Json[];
    expect(new Set(rows.map((row) => row.deploy_id)).size).toBe(1);
    expect(rows.every((row) => row.release_id === releaseId)).toBe(true);
  });

  test("deploying what every target already serves answers 200 and writes nothing", async () => {
    const projectId = await newProject(ACME);
    const releaseId = await newRelease(projectId);
    const initial = await call("POST", `/deployments?project_id=${projectId}`, {
      release: releaseId,
      targets: ["default"],
    });

    const again = await call("POST", `/deployments?project_id=${projectId}`, {
      release: releaseId,
      targets: ["default"],
    });

    expect(again.status).toBe(200);
    expect(first(again.body).id).toBe(first(initial.body).id);
    const log = await call("GET", `/deployments?project_id=${projectId}`);
    expect((log.body.deployments as Json[]).length).toBe(1);
  });

  test("a changed variable makes the same release a new deployment with the new value frozen", async () => {
    const projectId = await newProject(ACME);
    const releaseId = await newRelease(projectId);
    await call("PATCH", `/variables?project_id=${projectId}`, { SUPPORT_EMAIL: "help@acme.com" });
    const initial = await call("POST", `/deployments?project_id=${projectId}`, {
      release: releaseId,
      targets: ["default"],
    });
    await call("PATCH", `/variables?project_id=${projectId}`, { SUPPORT_EMAIL: "care@acme.com" });

    const second = await call("POST", `/deployments?project_id=${projectId}`, {
      release: releaseId,
      targets: ["default"],
    });

    expect(second.status).toBe(201);
    const firstId = first(initial.body).id as string;
    const secondId = first(second.body).id as string;
    const frozenFirst = await call("GET", `/deployments/${firstId}/variables?project_id=${projectId}`);
    const frozenSecond = await call("GET", `/deployments/${secondId}/variables?project_id=${projectId}`);
    expect(frozenFirst.body).toEqual({ SUPPORT_EMAIL: "help@acme.com" });
    expect(frozenSecond.body).toEqual({ SUPPORT_EMAIL: "care@acme.com" });
  });

  test("a preview deploy needs a ttl, writes a live origin row, and prefers preview values", async () => {
    const projectId = await newProject(ACME);
    const releaseId = await newRelease(projectId);
    await call("PATCH", `/variables?project_id=${projectId}`, {
      GOOGLE_CLIENT_SECRET: { value: "prod", secret: true },
      GOOGLE_CLIENT_ID: "prod-id",
    });
    await call("PATCH", `/variables?project_id=${projectId}&applies_to=preview`, {
      GOOGLE_CLIENT_ID: "preview-id",
    });
    const url = "https://acme-git-sso-acmeinc.vercel.app";

    const noTtl = await call("POST", `/deployments?project_id=${projectId}`, {
      release: releaseId,
      targets: [url],
    });
    expect(noTtl.status).toBe(400);

    const { status, body } = await call("POST", `/deployments?project_id=${projectId}`, {
      release: releaseId,
      targets: [url],
      ttl_seconds: 3600,
    });
    expect(status).toBe(201);
    expect(body.warnings).toEqual(["GOOGLE_CLIENT_SECRET has no preview value — serving the production one"]);

    const origins = await call("GET", `/origins?project_id=${projectId}`);
    expect((origins.body.origins as Json[]).map((row) => row.origin)).toEqual([url]);
    const live = await call("GET", `/deployments?project_id=${projectId}&live=true`);
    const row = first(live.body);
    expect(row.origin).toBe(url);
    expect(typeof row.expires_at).toBe("string");
    const frozen = await call("GET", `/deployments/${row.id as string}/variables?project_id=${projectId}`);
    expect(frozen.body).toEqual({ GOOGLE_CLIENT_ID: "preview-id", GOOGLE_CLIENT_SECRET: { secret: true } });
  });

  test("a preview run may not also move production, and an unlisted origin is refused", async () => {
    const projectId = await newProject(ACME);
    const releaseId = await newRelease(projectId);

    const mixed = await call("POST", `/deployments?project_id=${projectId}`, {
      release: releaseId,
      targets: ["default", "https://acme-git-sso-acmeinc.vercel.app"],
      ttl_seconds: 3600,
    });
    expect(mixed.status).toBe(400);

    const stranger = await call("POST", `/deployments?project_id=${projectId}`, {
      release: releaseId,
      targets: ["https://evil.example"],
      ttl_seconds: 3600,
    });
    expect(stranger.status).toBe(403);
    expect(stranger.body.code).toBe("proj.origin_not_allowed");
  });

  test("rollback undoes the newest deploy on every target it moved", async () => {
    const projectId = await newProject(ACME);
    const good = await newRelease(projectId, "sch_good");
    const bad = await newRelease(projectId, "sch_bad");
    await call("POST", `/deployments?project_id=${projectId}`, { release: good, targets: ["default", "primary"] });
    const broken = await call("POST", `/deployments?project_id=${projectId}`, {
      release: bad,
      targets: ["default", "primary"],
    });

    const { status, body } = await call("POST", `/deployments/rollback?project_id=${projectId}`, {});

    expect(status).toBe(201);
    const rows = body.deployments as Json[];
    expect(rows.map((row) => row.origin)).toEqual(["", "https://app.acme.com", "https://www.acme.com"]);
    expect(rows.every((row) => row.release_id === good)).toBe(true);
    expect(rows.every((row) => (row.metadata as Json).rollback_of === broken.body.deploy_id)).toBe(true);
    const live = await call("GET", `/deployments?project_id=${projectId}&live=true`);
    expect((live.body.deployments as Json[]).every((row) => row.release_id === good)).toBe(true);
  });

  test("rollback leaves a target with no earlier release alone and says so", async () => {
    const projectId = await newProject(ACME);
    const releaseId = await newRelease(projectId);
    await call("POST", `/deployments?project_id=${projectId}`, { release: releaseId, targets: ["default"] });

    const { body } = await call("POST", `/deployments/rollback?project_id=${projectId}`, {});

    expect(body.deployments).toEqual([]);
    expect(body.warnings).toEqual(["(default) has no earlier release and was left as it is"]);
  });

  test("a release resolves by digest prefix, and a revoked one cannot be deployed", async () => {
    const projectId = await newProject(ACME);
    const releaseId = await newRelease(projectId);
    const same = await call("POST", `/releases?project_id=${projectId}`, {
      pointers: [{ kind: "schema", revision_id: "sch_x" }],
    });
    const again = await call("POST", `/releases?project_id=${projectId}`, {
      pointers: [{ kind: "schema", revision_id: "sch_x" }],
    });
    expect(same.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(same.body.id);
    expect(same.body.content_hash).toMatch(/^[0-9a-f]{64}$/);
    const listed = await call("GET", `/releases?project_id=${projectId}`);
    expect((listed.body.releases as Json[]).map((r) => r.content_hash)).toContain(same.body.content_hash);
    const byDigest = await call("POST", `/deployments?project_id=${projectId}`, {
      release: `sha256:${(same.body.content_hash as string).slice(0, 16)}`,
      targets: ["default"],
    });
    expect(byDigest.status).toBe(201);
    expect(byDigest.body.release_id).toBe(same.body.id);

    const revoked = await call("POST", `/releases/${releaseId}/revoke?project_id=${projectId}`);
    expect(typeof revoked.body.revoked_at).toBe("string");
    const refused = await call("POST", `/deployments?project_id=${projectId}`, {
      release: releaseId,
      targets: ["default"],
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("rel.revoked");
  });

  test("the log filters by origin and deploy id, and the default is a row of its own", async () => {
    const projectId = await newProject(ACME);
    const releaseId = await newRelease(projectId);
    const deploy = await call("POST", `/deployments?project_id=${projectId}`, {
      release: releaseId,
      targets: ["default", "primary"],
    });

    const byOrigin = await call("GET", `/deployments?project_id=${projectId}&origin=`);
    expect((byOrigin.body.deployments as Json[]).map((row) => row.origin)).toEqual([""]);
    const byDeploy = await call(
      "GET",
      `/deployments?project_id=${projectId}&deploy_id=${deploy.body.deploy_id as string}&expand=release`,
    );
    const rows = byDeploy.body.deployments as Json[];
    expect(rows.length).toBe(3);
    expect((first(byDeploy.body).release as Json).id).toBe(releaseId);
  });
});

describe("allowlist and class", () => {
  test("adds a pattern with its lint result and refuses a duplicate", async () => {
    const projectId = await newProject();

    const added = await call("POST", `/projects/${projectId}/allowed_origins`, {
      pattern: "https://*-acmeinc.vercel.app",
      kind: "preview",
    });
    expect(added.status).toBe(201);
    expect((added.body.check as Json).status).toBe("ok");

    const unknown = await call("POST", `/projects/${projectId}/allowed_origins`, {
      pattern: "https://*.acme.newhost.dev",
      kind: "preview",
    });
    expect((unknown.body.check as Json).code).toBe("origin_host_unknown");

    const dup = await call("POST", `/projects/${projectId}/allowed_origins`, {
      pattern: "https://*-acmeinc.vercel.app",
      kind: "preview",
    });
    expect(dup.status).toBe(400);
  });

  test("promotion re-checks every pattern and a production project refuses loopback", async () => {
    const projectId = await newProject([{ pattern: "http://localhost:3000", kind: "primary" }]);

    const refused = await call("POST", `/projects/${projectId}/class`, { class: "production" });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("proj.origin_not_permitted_for_class");

    await call("POST", `/projects/${projectId}/allowed_origins/remove`, { pattern: "http://localhost:3000" });
    await call("POST", `/projects/${projectId}/allowed_origins`, { pattern: "https://app.acme.com", kind: "primary" });
    const promoted = await call("POST", `/projects/${projectId}/class`, { class: "production" });
    expect(promoted.status).toBe(200);
    expect(promoted.body.class).toBe("production");

    const wildcardPrimary = await call("POST", `/projects/${projectId}/allowed_origins`, {
      pattern: "https://*.acme.com",
      kind: "primary",
    });
    expect(wildcardPrimary.body.code).toBe("proj.origin_not_permitted_for_class");
    const unbounded = await call("POST", `/projects/${projectId}/allowed_origins`, {
      pattern: "https://*.vercel.app",
      kind: "preview",
    });
    expect(unbounded.body.code).toBe("proj.origin_unbounded");

    const demote = await call("POST", `/projects/${projectId}/class`, { class: "sandbox" });
    expect(demote.status).toBe(400);
    const confirmed = await call("POST", `/projects/${projectId}/class`, { class: "sandbox", confirm: true });
    expect(confirmed.body.class).toBe("sandbox");
  });
});

describe("the origin gate on POST /flow", () => {
  const start = (projectId: string, headers: Record<string, string>) =>
    call("POST", "/flow", { project_id: projectId, purpose: "login" }, headers);

  test("admits a primary, refuses an unlisted origin, and refuses a preview without a live row", async () => {
    const projectId = await newProject(ACME);

    expect((await start(projectId, { Origin: "https://app.acme.com" })).status).toBe(201);
    const stranger = await start(projectId, { Origin: "https://attacker.example" });
    expect(stranger.status).toBe(403);
    expect(stranger.body.code).toBe("proj.origin_not_allowed");
    const squatter = await start(projectId, { Origin: "https://evil-acmeinc.vercel.app" });
    expect(squatter.status).toBe(403);
    expect(squatter.body.code).toBe("proj.preview_not_live");
  });

  test("a live preview row admits its URL until it is retired", async () => {
    const projectId = await newProject(ACME);
    const releaseId = await newRelease(projectId);
    const url = "https://acme-git-sso-acmeinc.vercel.app";
    await call("POST", `/deployments?project_id=${projectId}`, {
      release: releaseId,
      targets: [url],
      ttl_seconds: 3600,
    });

    expect((await start(projectId, { Origin: url })).status).toBe(201);
    await call("POST", `/origins/remove?project_id=${projectId}`, { origin: url });
    expect((await start(projectId, { Origin: url })).body.code).toBe("proj.preview_not_live");
  });

  test("a pin selects among releases deployed to the target on a production project", async () => {
    const projectId = await newProject(ACME);
    const deployed = await newRelease(projectId, "sch_deployed");
    const draft = await newRelease(projectId, "sch_draft");
    await call("POST", `/deployments?project_id=${projectId}`, { release: deployed, targets: ["default", "primary"] });

    // sandbox: any release
    expect((await start(projectId, { "X-Zitadel-Release": draft })).status).toBe(201);

    await call("POST", `/projects/${projectId}/class`, { class: "production" });
    expect((await start(projectId, { "X-Zitadel-Release": deployed })).status).toBe(201);
    expect(
      (await start(projectId, { Origin: "https://app.acme.com", "X-Zitadel-Release": deployed })).status,
    ).toBe(201);
    const refused = await start(projectId, { Origin: "https://app.acme.com", "X-Zitadel-Release": draft });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("rel.not_deployed");
    const unknown = await start(projectId, { "X-Zitadel-Release": "rel_nope" });
    expect(unknown.status).toBe(404);
  });
});

describe("variables by applies_to", () => {
  test("keeps the preview value apart from the all value", async () => {
    const projectId = await newProject();
    await call("PATCH", `/variables?project_id=${projectId}`, { SHARED: "all" });
    await call("PATCH", `/variables?project_id=${projectId}&applies_to=preview`, { SHARED: "preview" });

    expect((await call("GET", `/variables?project_id=${projectId}`)).body).toEqual({ SHARED: "all" });
    expect((await call("GET", `/variables?project_id=${projectId}&applies_to=preview`)).body).toEqual({
      SHARED: "preview",
    });
    expect((await call("GET", `/variables/SHARED?project_id=${projectId}&applies_to=preview`)).body).toBe("preview");

    expect((await call("DELETE", `/variables/SHARED?project_id=${projectId}&applies_to=preview`)).status).toBe(204);
    expect((await call("GET", `/variables/SHARED?project_id=${projectId}&applies_to=preview`)).status).toBe(404);
    expect((await call("GET", `/variables?project_id=${projectId}`)).body).toEqual({ SHARED: "all" });
  });
});
