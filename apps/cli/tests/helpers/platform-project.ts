import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetPlatformStore, setupPlatformHandlers } from "@zitadel/api-mock/platform";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

import { DEFAULT_SERVER } from "../../src/lib/server";

/** The platform the unit tests' msw server answers for. */
export const PLATFORM_URL = DEFAULT_SERVER;

/** POSTs to the mock platform as a project's secret, and returns the parsed body. */
export async function callPlatform(
  path: string,
  secret: string,
  body: object,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${PLATFORM_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  return (await response.json()) as Record<string, unknown>;
}

/**
 * A Next.js app directory bound to a project through `.zitadel/secret`. The
 * caller removes it.
 */
export async function aProjectDirectory(
  prefix: string,
  project: { id: string; secret: string },
): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(join(cwd, "zitadel.json"), JSON.stringify({ framework: { id: "next" } }));
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify({
      project_id: project.id,
      project_secret: project.secret,
      preview_secret: "pk",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    }),
  );
  return cwd;
}

/**
 * A project on the mock with two deploys to one primary origin, its
 * directory, and the second deployment's id. The caller removes the directory.
 */
export async function aProjectWithTwoDeploys(
  prefix: string,
): Promise<{ cwd: string; undone: string }> {
  const project = await callPlatform("/projects", "", { name: prefix });
  const id = project.id as string;
  const secret = project.project_secret as string;
  await callPlatform(`/projects/${id}/origins`, secret, {
    pattern: "https://app.acme.com",
    kind: "primary",
  });
  let undone = "";
  for (const revision of ["sch_a", "sch_b"]) {
    const release = await callPlatform(`/releases?project_id=${id}`, secret, {
      pointers: [{ kind: "schema", revision_id: revision }],
    });
    const deployment = await callPlatform(`/deployments?project_id=${id}`, secret, {
      release_id: release.id,
      targets: ["primary"],
    });
    undone = deployment.id as string;
  }
  return { cwd: await aProjectDirectory(prefix, { id, secret }), undone };
}

/**
 * Answers the live deployment list in two pages: a live preview first, and
 * `primary` only behind the cursor, so a read of the first page alone misses it.
 */
export function liveAcrossTwoPages(primary: { id: string; release_id: string }) {
  return http.get(`${PLATFORM_URL}/deployments`, ({ request }) => {
    const query = new URL(request.url).searchParams;
    if (query.get("live") !== "true") {
      return undefined;
    }
    return HttpResponse.json(
      query.get("page_token") === "p2"
        ? {
            deployments: [
              {
                ...primary,
                targets: [{ origin: "https://app.acme.com", expires_at: null }],
                reason: "deploy",
                deployed_at: "2026-01-01T00:00:00.000Z",
              },
            ],
            next_page_token: null,
          }
        : {
            deployments: [
              {
                id: "dep_preview",
                release_id: "rel_preview",
                targets: [
                  { origin: "https://pr-1.acme.com", expires_at: "2027-01-01T00:00:00.000Z" },
                ],
                reason: "deploy",
                deployed_at: "2026-01-02T00:00:00.000Z",
              },
            ],
            next_page_token: "p2",
          },
    );
  });
}

/**
 * An msw server answering as the mock platform for the calling suite, and the
 * project directories it removes after each test.
 */
export function usePlatformServer(): { server: ReturnType<typeof setupServer>; dirs: string[] } {
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
  return { server, dirs };
}
