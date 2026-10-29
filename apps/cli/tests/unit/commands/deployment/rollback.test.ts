import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetPlatformStore, setupPlatformHandlers } from "@zitadel/api-mock/platform";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { runCliForTest } from "../../../helpers/run-cli";

const SERVER = "https://api.zitadel.cloud";
const server = setupServer(...setupPlatformHandlers());
const dirs: string[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(async () => {
  server.resetHandlers();
  resetPlatformStore();
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function call(path: string, secret: string, body: object): Promise<Record<string, unknown>> {
  const response = await fetch(`${SERVER}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  return (await response.json()) as Record<string, unknown>;
}

/** A project on the mock with two deploys to one primary origin, and its directory. */
async function twoDeploys(): Promise<{
  cwd: string;
  first: string;
  undone: string;
  projectId: string;
  secret: string;
}> {
  const project = await call("/projects", "", { name: "rollback" });
  const id = project.id as string;
  const secret = project.project_secret as string;
  await call(`/projects/${id}/origins`, secret, {
    pattern: "https://app.acme.com",
    kind: "primary",
  });
  const deployed: string[] = [];
  for (const revision of ["sch_a", "sch_b"]) {
    const release = await call(`/releases?project_id=${id}`, secret, {
      pointers: [{ kind: "schema", revision_id: revision }],
    });
    const deployment = await call(`/deployments?project_id=${id}`, secret, {
      release_id: release.id,
      targets: ["primary"],
    });
    deployed.push(deployment.id as string);
  }
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-rollback-"));
  dirs.push(cwd);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(join(cwd, "zitadel.json"), JSON.stringify({ framework: { id: "next" } }));
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify({
      project_id: id,
      project_secret: secret,
      preview_secret: "pk",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    }),
  );
  return {
    cwd,
    first: deployed[0] as string,
    undone: deployed[1] as string,
    projectId: id,
    secret,
  };
}

describe("deployment rollback", () => {
  it("guards a bare rollback with the deployment its history read undid, not a later live one", async () => {
    const { cwd, undone } = await twoDeploys();
    // A deploy that lands after the history was read shows up only in a later
    // live read; the guard must still name the deployment the decision undid.
    server.use(
      http.get(`${SERVER}/deployments`, ({ request }) =>
        new URL(request.url).searchParams.get("live") === "true"
          ? HttpResponse.json({
              deployments: [
                {
                  id: "dep_landed_since",
                  release_id: "rel_x",
                  targets: [{ origin: "https://app.acme.com", expires_at: null }],
                  reason: "deploy",
                  deployed_at: "2026-01-02T00:00:00.000Z",
                },
              ],
              next_page_token: null,
            })
          : undefined,
      ),
    );
    const guards: unknown[] = [];
    server.use(
      http.post(`${SERVER}/deployments/:id/rollback`, async ({ request }) => {
        const text = await request.clone().text();
        guards.push(
          text === ""
            ? undefined
            : (JSON.parse(text) as Record<string, unknown>).expected_deployment_id,
        );
        return undefined;
      }),
    );

    await runCliForTest([
      "deployment",
      "rollback",
      "--force",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--json",
    ]);

    expect(guards).toEqual([undone]);
  });

  it("guards a rollback with the newest deployment to what it writes, not a newer default-only one", async () => {
    const { cwd, first, undone, projectId, secret } = await twoDeploys();
    const release = await call(`/releases?project_id=${projectId}`, secret, {
      pointers: [{ kind: "schema", revision_id: "sch_c" }],
    });
    await call(`/deployments?project_id=${projectId}`, secret, {
      release_id: release.id,
      targets: ["default"],
    });
    const guards: unknown[] = [];
    server.use(
      http.post(`${SERVER}/deployments/:id/rollback`, async ({ request }) => {
        guards.push(
          (JSON.parse(await request.clone().text()) as Record<string, unknown>)
            .expected_deployment_id,
        );
        return undefined;
      }),
    );

    const { exitCode } = await runCliForTest([
      "deployment",
      "rollback",
      first,
      "--force",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--json",
    ]);

    expect(guards).toEqual([undone]);
    expect(exitCode).toBe(0);
  });

  it("reports the revisions the restored release pins", async () => {
    const { cwd } = await twoDeploys();

    const { stdout } = await runCliForTest([
      "deployment",
      "rollback",
      "--force",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--json",
    ]);

    const envelope = JSON.parse(stdout) as { data: { pointers: unknown[] } };
    expect(envelope.data.pointers).toEqual([
      expect.objectContaining({ kind: "schema", revision_id: "sch_a" }),
    ]);
  });

  it("tells a terminal that users keep their revisions", async () => {
    const { cwd } = await twoDeploys();

    const { stdout } = await runCliForTest([
      "deployment",
      "rollback",
      "--force",
      "--cwd",
      cwd,
      "--server",
      SERVER,
    ]);

    expect(stdout).toContain("sch_a");
    expect(stdout).toContain(
      "Users keep the schema revision and attributes they have: a rollback does not migrate them back.",
    );
  });

  it("warns rather than fails when the restored release cannot be read", async () => {
    const { cwd } = await twoDeploys();
    server.use(
      http.get(`${SERVER}/releases/:id`, () =>
        HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
      ),
    );

    const { exitCode, stdout } = await runCliForTest([
      "deployment",
      "rollback",
      "--force",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--json",
    ]);

    const envelope = JSON.parse(stdout) as {
      status: string;
      data: Record<string, unknown>;
      warnings: string[];
    };
    expect(exitCode).toBe(0);
    expect(envelope.status).toBe("ok");
    expect(envelope.data).not.toHaveProperty("pointers");
    expect(envelope.warnings).toEqual([expect.stringContaining("could not be read")]);
  });
});
