import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { IDPS_DIR } from "../../../../../src/lib/idp";
import type { StepContext } from "../../../../../src/lib/release/pipeline";
import { idpConnectionsStep } from "../../../../../src/lib/release/steps/idp-connections";
import type { SuggestedCommand } from "../../../../../src/lib/suggestion";

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

/** The variables the project holds unless a test says otherwise: the secret googleBody names. */
const HELD = { GOOGLE_CLIENT_SECRET: { secret: true } };

function ctx(cwd: string, over: Partial<StepContext>, held: object = HELD): StepContext {
  const { client, ...rest } = over;
  return {
    cwd,
    client: { getVariables: async () => held, ...(client as object | undefined) } as never,
    projectId: "proj_1",
    env: {},
    mode: "deploy",
    dryRun: false,
    json: true,
    color: false,
    bundle: { schemas: [], flow_definitions: [], brandings: [] },
    brandingSources: [],
    suggest: (args) => `${args} --env staging` as SuggestedCommand,
    ...rest,
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

  it("refuses a connection whose client_secret names a variable the project lacks", async () => {
    const cwd = await project({ "google.json": googleBody() });

    await expect(idpConnectionsStep.run(ctx(cwd, {}, {}))).rejects.toMatchObject({
      code: "E_CREDENTIAL_MISSING",
    });
  });

  it("suggests publishing a missing variable in the environment the deploy addressed", async () => {
    const cwd = await project({ "google.json": googleBody() });

    await expect(idpConnectionsStep.run(ctx(cwd, {}, {}))).rejects.toMatchObject({
      nextCommands: ["variable set GOOGLE_CLIENT_SECRET --secret --env staging"],
    });
  });

  it("refuses a client_secret held in a plain variable", async () => {
    const cwd = await project({ "google.json": googleBody() });

    await expect(
      idpConnectionsStep.run(ctx(cwd, {}, { GOOGLE_CLIENT_SECRET: "plain" })),
    ).rejects.toThrow(/which is not a secret/);
  });

  it("refuses a client_id held in a secret variable", async () => {
    const cwd = await project({
      "google.json": googleBody({
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "${{ GOOGLE_CLIENT_ID }}",
          client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
          scopes: ["openid"],
        },
      }),
    });

    await expect(
      idpConnectionsStep.run(
        ctx(
          cwd,
          {},
          { GOOGLE_CLIENT_ID: { secret: true }, GOOGLE_CLIENT_SECRET: { secret: true } },
        ),
      ),
    ).rejects.toThrow(/which is a secret/);
  });

  it("names the connection file in the refusal", async () => {
    const cwd = await project({ "google-workspace.json": googleBody() });

    await expect(idpConnectionsStep.run(ctx(cwd, {}, {}))).rejects.toThrow(
      /\.zitadel\/idps\/google-workspace\.json/,
    );
  });
});
