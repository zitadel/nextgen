import { ApiError } from "@zitadel/api/runtime/fetch";
import { describe, expect, it } from "vitest";

import type { StepContext } from "../../../../../src/lib/release/pipeline";
import { validateConnections } from "../../../../../src/lib/release/steps/idp-checks";
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

/** The connections the bundle in hand carries, with the files they came from. */
let connections: { name: string; body: Record<string, unknown> }[] = [];

/** Puts the connections in the bundle the checks read, as `buildBundle` would. */
function project(files: Record<string, unknown>): string {
  connections = Object.entries(files).map(([name, body]) => ({
    name,
    body: body as Record<string, unknown>,
  }));
  return "/tmp/project";
}

/** The variables the project holds unless a test says otherwise: the secret googleBody names. */
const HELD = { GOOGLE_CLIENT_SECRET: { secret: true } };

function ctx(cwd: string, over: Partial<StepContext>, held: object = HELD): StepContext {
  const { client, ...rest } = over;
  return {
    cwd,
    client: {
      // Variables read back keyed by kind: these tests hold the same values for
      // whichever kind the run asks for, unless one stubs its own read.
      getVariables: async (params: { kind?: string }) =>
        Object.fromEntries(
          Object.entries(held).map(([name, value]) => [
            name,
            { [params.kind ?? "primary"]: value },
          ]),
        ),
      ...(client as object | undefined),
    } as never,
    projectId: "proj_1",
    env: {},
    mode: "deploy",
    dryRun: false,
    json: true,
    color: false,
    bundle: {
      schemas: [],
      flow_definitions: [],
      idps: connections.map((entry) => entry.body),
      policies: [],
    },
    brandingSources: [],
    idpFiles: connections.map((entry) => entry.name),
    policyFiles: [],
    suggest: (args) => `${args} --env staging` as SuggestedCommand,
    ...rest,
  };
}

describe("connection checks", () => {
  it("rejects a literal client_secret, which must never leave the machine", async () => {
    const cwd = project({
      "google.json": googleBody({
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "111.apps.googleusercontent.com",
          client_secret: "a-literal-secret",
          scopes: ["openid"],
        },
      }),
    });
    await expect(validateConnections(ctx(cwd, { dryRun: true }))).rejects.toThrow();
  });

  it("refuses a connection a preview names with a variable the project lacks", async () => {
    const cwd = project({ "google.json": googleBody() });

    await expect(validateConnections(ctx(cwd, { mode: "preview" }, {}))).rejects.toMatchObject({
      code: "E_CREDENTIAL_MISSING",
    });
  });

  it("reads the preview kind for a preview, so a primary-only secret does not count", async () => {
    const cwd = project({ "google.json": googleBody() });
    const getVariables = vi.fn(async (params: { kind?: string }) =>
      params.kind === "preview" ? {} : { GOOGLE_CLIENT_SECRET: { primary: { secret: true } } },
    );

    await expect(
      validateConnections(ctx(cwd, { mode: "preview", client: { getVariables } as never })),
    ).rejects.toMatchObject({ code: "E_CREDENTIAL_MISSING" });
  });

  it("suggests setting the missing credential for the preview kind", async () => {
    const cwd = project({ "google.json": googleBody() });

    await expect(validateConnections(ctx(cwd, { mode: "preview" }, {}))).rejects.toMatchObject({
      nextCommands: ["variable set GOOGLE_CLIENT_SECRET --secret --preview --env staging"],
    });
  });

  it("counts a credential the preview kind holds", async () => {
    const cwd = project({ "google.json": googleBody() });
    const getVariables = vi.fn(async (params: { kind?: string }) =>
      params.kind === "preview" ? { GOOGLE_CLIENT_SECRET: { preview: { secret: true } } } : {},
    );

    await expect(
      validateConnections(ctx(cwd, { mode: "preview", client: { getVariables } as never })),
    ).resolves.toBeUndefined();
  });

  it("leaves the variable check to the deploy when a preview's token may not read them", async () => {
    const cwd = project({ "google.json": googleBody() });
    const getVariables = vi
      .fn()
      .mockRejectedValue(new ApiError(403, "https://api.example/variables", {}, "Forbidden"));

    await expect(
      validateConnections(ctx(cwd, { mode: "preview", client: { getVariables } as never })),
    ).resolves.toBeUndefined();
  });

  it("names the deploy's environment in how to publish a literal client_secret", async () => {
    const cwd = project({
      "google.json": googleBody({
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "111.apps.googleusercontent.com",
          client_secret: "a-literal-secret",
          scopes: ["openid"],
        },
      }),
    });

    await expect(validateConnections(ctx(cwd, {}))).rejects.toMatchObject({
      hint: expect.stringContaining("variable set NAME --secret --env staging"),
    });
  });

  it("refuses an oidc block that names some endpoints but not the rest", async () => {
    const cwd = project({
      "google.json": googleBody({
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "111.apps.googleusercontent.com",
          client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
          authorization_endpoint: "https://accounts.google.com/auth",
          scopes: ["openid"],
        },
      }),
    });

    await expect(validateConnections(ctx(cwd, {}))).rejects.toThrow(
      /google\.json: oidc names some endpoints but not jwks_uri, token_endpoint, userinfo_endpoint/,
    );
  });

  it("accepts an oidc block that names every endpoint", async () => {
    const cwd = project({
      "google.json": googleBody({
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "111.apps.googleusercontent.com",
          client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
          authorization_endpoint: "https://accounts.google.com/auth",
          jwks_uri: "https://accounts.google.com/jwks",
          token_endpoint: "https://accounts.google.com/token",
          userinfo_endpoint: "https://accounts.google.com/userinfo",
          scopes: ["openid"],
        },
      }),
    });
    await expect(validateConnections(ctx(cwd, {}))).resolves.toBeUndefined();
  });

  it("refuses the whole bundle when a later connection is malformed", async () => {
    const cwd = project({
      "a-google.json": googleBody(),
      "b-bad.json": { slug: "bad", protocol: "oidc" },
    });

    await expect(validateConnections(ctx(cwd, {}))).rejects.toThrow();
  });

  it("refuses a connection whose client_secret names a variable the project lacks", async () => {
    const cwd = project({ "google.json": googleBody() });

    await expect(validateConnections(ctx(cwd, {}, {}))).rejects.toMatchObject({
      code: "E_CREDENTIAL_MISSING",
    });
  });

  it("suggests publishing a missing variable in the environment the deploy addressed", async () => {
    const cwd = project({ "google.json": googleBody() });

    await expect(validateConnections(ctx(cwd, {}, {}))).rejects.toMatchObject({
      nextCommands: ["variable set GOOGLE_CLIENT_SECRET --secret --env staging"],
    });
  });

  it("refuses a client_secret held in a plain variable", async () => {
    const cwd = project({ "google.json": googleBody() });

    await expect(
      validateConnections(ctx(cwd, {}, { GOOGLE_CLIENT_SECRET: "plain" })),
    ).rejects.toThrow(/which is not a secret/);
  });

  it("refuses a client_id held in a secret variable", async () => {
    const cwd = project({
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
      validateConnections(
        ctx(
          cwd,
          {},
          { GOOGLE_CLIENT_ID: { secret: true }, GOOGLE_CLIENT_SECRET: { secret: true } },
        ),
      ),
    ).rejects.toThrow(/which is a secret/);
  });

  it("names the connection file in the refusal", async () => {
    const cwd = project({ "google-workspace.json": googleBody() });

    await expect(validateConnections(ctx(cwd, {}, {}))).rejects.toThrow(
      /\.zitadel\/idps\/google-workspace\.json/,
    );
  });
});
