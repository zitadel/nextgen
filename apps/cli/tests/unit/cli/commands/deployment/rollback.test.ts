import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import DeploymentRollback from "@/cli/commands/deployment/rollback/index";
import { answering } from "@tests/helpers/keyboard";
import { asTerminal as asPerson } from "@tests/helpers/terminal";
import {
  aProjectWithTwoDeploys,
  liveAcrossTwoPages,
  PLATFORM_URL,
  usePlatformServer,
} from "@tests/helpers/platform-project";
import { runCliForTest } from "@tests/helpers/run-cli";
import { runCommand } from "@tests/helpers/run-cli";
import { PRIMARY_ORIGIN } from "@tests/helpers/records";

const SERVER = PLATFORM_URL;
const { server, dirs } = usePlatformServer();

/** A project on the mock with two deploys to one primary origin, and its directory. */
async function twoDeploys(): Promise<{ cwd: string; undone: string }> {
  const project = await aProjectWithTwoDeploys("zitadel-rollback-");
  dirs.push(project.cwd);
  return project;
}

describe("deployment rollback", () => {
  it("guards a bare rollback with the deployment its history read undid, not a later live one", async () => {
    const { cwd, undone } = await twoDeploys();
    // A deploy that lands after the history was read shows up only in a later
    // live read; the guard must still name the deployment the decision undid.
    server.use(
      http.get(`${SERVER}/api/v1/deployments`, ({ request }) =>
        new URL(request.url).searchParams.get("live") === "true"
          ? HttpResponse.json({
              deployments: [
                {
                  id: "dep_landed_since",
                  release_id: "rel_x",
                  kind: "primary",
                  targets: [{ origin: PRIMARY_ORIGIN }],
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
      http.post(`${SERVER}/api/v1/deployments/:id/rollback`, async ({ request }) => {
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

  it("rolls a bare rollback back to the prior primary listed past the first page", async () => {
    const { cwd } = await twoDeploys();
    const primary = (id: string, deployedAt: string) => ({
      id,
      release_id: `rel_${id}`,
      kind: "primary",
      targets: [{ origin: PRIMARY_ORIGIN }],
      metadata: { reason: "deploy" },
      deployed_at: deployedAt,
    });
    server.use(
      http.get(`${SERVER}/api/v1/deployments`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        if (query.get("live") === "true") {
          return undefined;
        }
        return HttpResponse.json(
          query.get("page_token") === "h2"
            ? {
                deployments: [primary("dep_prior", "2026-01-01T00:00:00.000Z")],
                next_page_token: null,
              }
            : {
                deployments: [primary("dep_latest", "2026-01-02T00:00:00.000Z")],
                next_page_token: "h2",
              },
        );
      }),
    );
    const targets: string[] = [];
    server.use(
      http.post(`${SERVER}/api/v1/deployments/:id/rollback`, ({ params }) => {
        targets.push(String(params.id));
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

    expect(targets).toEqual(["dep_prior"]);
  });

  it("guards a rollback to a named deployment with the primary that is live, past the first page", async () => {
    const { cwd, undone } = await twoDeploys();
    server.use(liveAcrossTwoPages({ id: "dep_live_primary", release_id: "rel_live" }));
    const guards: unknown[] = [];
    server.use(
      http.post<{ id: string }, { expected_deployment_id?: string }>(
        `${SERVER}/api/v1/deployments/:id/rollback`,
        async ({ request }) => {
          const body = await request.clone().json();
          guards.push(body.expected_deployment_id);
          return undefined;
        },
      ),
    );

    await runCliForTest([
      "deployment",
      "rollback",
      undone,
      "--force",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--json",
    ]);

    expect(guards).toEqual(["dep_live_primary"]);
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
      http.get(`${SERVER}/api/v1/releases/:id`, () =>
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
  it("leaves the origin check out when it cannot run", async () => {
    const { cwd } = await twoDeploys();
    server.use(
      http.get(`${SERVER}/api/v1/deployments/:id`, () =>
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
      data: Record<string, unknown>;
      warnings: string[];
    };
    expect(exitCode).toBe(0);
    expect(envelope.data).not.toHaveProperty("dropped_origins");
    expect(envelope.data).not.toHaveProperty("unserved_origins");
    expect(envelope.warnings).toEqual([expect.stringContaining("Could not check which origins")]);
  });
});

describe("deployment rollback asked on a terminal", () => {
  const rollingBackOn = async (serverUrl: string) => {
    const { cwd } = await twoDeploys();
    const talk = answering(false);
    await asPerson(() =>
      runCommand(DeploymentRollback, "deployment:rollback", ["--cwd", cwd, "--server", serverUrl]),
    );
    return talk;
  };

  it("asks whether to roll back, naming the project and a remote server", async () => {
    const talk = await rollingBackOn(SERVER);

    expect(talk.asked()).toEqual([
      expect.stringMatching(
        /^Roll back to dep_\S+ in project proj-\S+ on preview\.zitadel\.com so its release goes live again\?$/,
      ),
    ]);
  });

  it("names a local server by its host and port", async () => {
    const talk = await rollingBackOn("http://localhost:8112");

    expect(talk.asked()).toEqual([
      expect.stringMatching(
        /^Roll back to dep_\S+ in project proj-\S+ on localhost:8112 so its release goes live again\?$/,
      ),
    ]);
  });
});
