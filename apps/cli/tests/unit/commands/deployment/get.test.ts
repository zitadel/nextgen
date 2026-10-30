import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { onATerminal } from "../../../helpers/project";
import { runCliForTest } from "../../../helpers/run-cli";

const SERVER = "https://api.zitadel.cloud";
const server = setupServer();
const dirs: string[] = [];

/** How many times the run asked for the frozen set, which only a terminal does. */
let variableReads = 0;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(async () => {
  server.resetHandlers();
  variableReads = 0;
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const DEPLOYMENT = {
  id: "dep_1",
  project_id: "proj_test",
  release_id: "rel_1",
  targets: [{ origin: "https://app.acme.com", expires_at: null }],
  kind: "primary",
  status: "live",
  metadata: { reason: "deploy" },
  deployed_at: "2026-01-01T00:00:00.000Z",
};

const FROZEN = { HOST: "app.acme.com", TOKEN: { secret: true } };

async function aProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-deployment-get-"));
  dirs.push(cwd);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify({
      project_id: "proj_test",
      project_secret: "sk_test",
      preview_secret: "pk_test",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    }),
  );
  server.use(
    http.get(`${SERVER}/deployments/dep_1`, () => HttpResponse.json(DEPLOYMENT)),
    http.get(`${SERVER}/deployments/dep_1/variables`, () => {
      variableReads += 1;
      return HttpResponse.json(FROZEN);
    }),
  );
  return cwd;
}

const read = (cwd: string) =>
  runCliForTest([
    "deployment",
    "get",
    "dep_1",
    "--cwd",
    cwd,
    "--server",
    SERVER,
    "--non-interactive",
    "--no-telemetry",
  ]);

describe("deployment get", () => {
  it("lays the record out the way every other get does", async () => {
    const cwd = await aProject();

    const res = await onATerminal(() => read(cwd));

    expect(res.exitCode).toBe(0);
    // At the left margin, headed by what identifies it, and carrying the id
    // the record is addressed by.
    expect(res.stdout).toContain("dep_1");
    expect(res.stdout).toMatch(/^id {2,}dep_1$/m);
    // The fields themselves, as against the hand-rolled view that indented
    // every one of them two spaces under the identifier.
    expect(res.stdout).not.toMatch(/^ {2}(id|release|reason|origins|deployed)/m);
  });

  it("names each field as the wire names it, not in words of its own", async () => {
    const cwd = await aProject();

    const res = await onATerminal(() => read(cwd));

    expect(res.stdout).toMatch(/^release_id {2,}rel_1$/m);
    expect(res.stdout).toMatch(/^deployed_at {2,}2026-01-01T00:00:00\.000Z$/m);
    expect(res.stdout).not.toContain("deployed  ");
    expect(res.stdout).not.toMatch(/^release {2,}/m);
  });

  it("tables the set the deployment froze under the fields, a secret masked", async () => {
    const cwd = await aProject();

    const res = await onATerminal(() => read(cwd));

    // A block under a record is headed at the margin with its table indented
    // under it, the way a release's pointers are.
    expect(res.stdout).toMatch(/^variables$/m);
    expect(res.stdout).toMatch(/^ {2}HOST {2,}app\.acme\.com$/m);
    expect(res.stdout).toMatch(/^ {2}TOKEN {2,}\(secret\)$/m);
  });

  it("gives a pipe the record itself, as every other get does", async () => {
    const cwd = await aProject();

    const res = await read(cwd);

    expect(JSON.parse(res.stdout)).toMatchObject({ id: "dep_1", kind: "primary" });
  });

  it("asks for the frozen set only for the rendering that names it", async () => {
    const cwd = await aProject();

    await read(cwd);
    expect(variableReads).toBe(0);

    await onATerminal(() => read(cwd));
    expect(variableReads).toBe(1);
  });
});
