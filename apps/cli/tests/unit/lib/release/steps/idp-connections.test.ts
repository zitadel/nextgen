import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { IDPS_DIR } from "../../../../../src/lib/idp";
import type { StepContext } from "../../../../../src/lib/release/pipeline";
import { idpConnectionsStep } from "../../../../../src/lib/release/steps/idp-connections";

/** A connection the server would accept: a `${{ NAME }}` client_secret. */
const googleBody = (over: Record<string, unknown> = {}) => ({
  slug: "google",
  protocol: "oidc",
  template: "google",
  display_name: "Google",
  oidc: {
    issuer: "https://accounts.google.com",
    client_id: "111.apps.googleusercontent.com",
    client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
    scopes: ["openid"],
  },
  ...over,
});

let dir: string;

async function project(files: Record<string, unknown>): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "zitadel-idp-step-"));
  await mkdir(join(dir, IDPS_DIR), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, IDPS_DIR, name), JSON.stringify(body), "utf8");
  }
  return dir;
}

function ctx(cwd: string, over: Partial<StepContext>): StepContext {
  return {
    cwd,
    client: {} as never,
    projectId: "proj_1",
    env: {},
    mode: "deploy",
    dryRun: false,
    json: true,
    color: false,
    bundle: { schemas: [], flow_definitions: [], brandings: [] },
    brandingSources: [],
    ...over,
  };
}

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("idp-connections step", () => {
  it("writes no idp on a dry run but still runs", async () => {
    const cwd = await project({ "google.json": googleBody() });
    const createIdp = vi.fn();

    await idpConnectionsStep.run(ctx(cwd, { dryRun: true, client: { createIdp } as never }));

    expect(createIdp).not.toHaveBeenCalled();
  });

  it("validates the files on a dry run, rejecting a literal client_secret", async () => {
    const cwd = await project({
      "google.json": googleBody({
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "111.apps.googleusercontent.com",
          client_secret: "a-literal-secret",
          scopes: ["openid"],
        },
      }),
    });
    const createIdp = vi.fn();

    await expect(
      idpConnectionsStep.run(ctx(cwd, { dryRun: true, client: { createIdp } as never })),
    ).rejects.toThrow();
    expect(createIdp).not.toHaveBeenCalled();
  });

  it("creates no connection when a later file is malformed", async () => {
    // Lexical order: `a-google.json` is read before `b-bad.json`, so a
    // validate-then-create loop would create the first before the second
    // failed. Validating the whole set first must leave none created.
    const cwd = await project({
      "a-google.json": googleBody(),
      "b-bad.json": { slug: "bad", protocol: "oidc" },
    });
    const createIdp = vi.fn().mockResolvedValue({ id: "idp_1" });

    await expect(
      idpConnectionsStep.run(ctx(cwd, { client: { createIdp } as never })),
    ).rejects.toThrow();
    expect(createIdp).not.toHaveBeenCalled();
  });

  it("creates each connection on a real run", async () => {
    const cwd = await project({ "google.json": googleBody() });
    const createIdp = vi.fn().mockResolvedValue({ id: "idp_1" });

    await idpConnectionsStep.run(ctx(cwd, { client: { createIdp } as never }));

    expect(createIdp).toHaveBeenCalledTimes(1);
  });
});
