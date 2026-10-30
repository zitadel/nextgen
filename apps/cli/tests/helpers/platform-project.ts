import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
 * directory, and both deployments' ids. The caller removes the directory.
 */
export async function aProjectWithTwoDeploys(prefix: string): Promise<{
  cwd: string;
  first: string;
  undone: string;
  projectId: string;
  secret: string;
}> {
  const project = await callPlatform("/projects", "", { name: prefix });
  const id = project.id as string;
  const secret = project.project_secret as string;
  await callPlatform(`/projects/${id}/origins`, secret, {
    pattern: "https://app.acme.com",
    kind: "primary",
  });
  const deployed: string[] = [];
  for (const revision of ["sch_a", "sch_b"]) {
    const release = await callPlatform(`/releases?project_id=${id}`, secret, {
      pointers: [{ kind: "schema", revision_id: revision }],
    });
    const deployment = await callPlatform(`/deployments?project_id=${id}`, secret, {
      release_id: release.id,
      targets: ["primary"],
    });
    deployed.push(deployment.id as string);
  }
  return {
    cwd: await aProjectDirectory(prefix, { id, secret }),
    first: deployed[0] as string,
    undone: deployed[1] as string,
    projectId: id,
    secret,
  };
}
