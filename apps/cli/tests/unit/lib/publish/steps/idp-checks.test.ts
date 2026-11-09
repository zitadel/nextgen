import type { GetVariable200 } from "@zitadel/api/generated/model";
import { describe, expect, it, vi } from "vitest";

import type { StepContext } from "@/lib/publish/pipeline";
import { validateConnections } from "@/lib/publish/steps/idp-checks";
import { DeploymentService, VariableService, SchemaService, UserService } from "@/lib/backend";
import { type ClientStubs, fakeClient } from "@tests/helpers/fake-client";
import type { SuggestedCommand } from "@/lib/suggestion";
import { ForbiddenError } from "@/lib/backend/errors";
import { type JsonObject, MemoryStore, ZitadelConfig } from "@/lib/zitadel";

/** A connection the server would accept: a `${{ NAME }}` client_secret. */
const googleBody = (over: JsonObject = {}) => {
  return {
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
  };
};

/** The configuration holding these connection files, by file name under `.zitadel/idps/`. */
function project(files: Record<string, JsonObject>): ZitadelConfig {
  return ZitadelConfig.of({
    schemas: [],
    flows: [],
    connections: Object.entries(files).map(([name, body]) => {
      return { path: `.zitadel/idps/${name}`, body };
    }),
    policies: [],
    branding: [],
  });
}

/** A value the API answers for a secret: named, never disclosed. */
const SECRET: GetVariable200["primary"] = { secret: true };

/** The variables the project holds unless a test says otherwise: the secret googleBody names. */
const HELD = { GOOGLE_CLIENT_SECRET: SECRET };

function ctx(
  config: ZitadelConfig,
  over: Partial<StepContext> & { client?: ClientStubs },
  held: Record<string, GetVariable200["primary"]> = HELD,
): StepContext {
  const { client, ...rest } = over;
  const stubs = fakeClient({
    // Variables read back keyed by kind: these tests hold the same values for
    // whichever kind the run asks for, unless one stubs its own read.
    getVariables: async (params) => {
      return Object.fromEntries(
        Object.entries(held).map(([name, value]) => {
          return [name, { [params.kind ?? "primary"]: value }];
        }),
      );
    },
    ...client,
  });
  const store = new MemoryStore();
  return {
    cwd: "/tmp/project",
    deployments: new DeploymentService(fakeClient({}), "proj_1"),
    variables: new VariableService(stubs, "proj_1"),
    schemas: new SchemaService(fakeClient({}), "proj_1"),
    users: new UserService(fakeClient({})),
    env: {},
    mode: "deploy",
    dryRun: false,
    json: true,
    color: false,
    config,
    store,
    bundle: config.bundle(store).bundle,
    suggest: (args) => {
      return `${args} --env staging` as SuggestedCommand;
    },
    ...rest,
  };
}

describe("validateConnections", () => {
  it("accepts a client_secret that references a variable", async () => {
    const config = project({ "google.json": googleBody() });

    await expect(validateConnections(ctx(config, {}))).resolves.toBeUndefined();
  });

  it("accepts a connection with no oidc block", async () => {
    const config = project({ "saml.json": { slug: "saml", protocol: "saml" } });

    await expect(validateConnections(ctx(config, {}))).resolves.toBeUndefined();
  });

  it("refuses a connection a preview names with a variable the project lacks", async () => {
    const config = project({ "google.json": googleBody() });

    await expect(validateConnections(ctx(config, { mode: "preview" }, {}))).rejects.toMatchObject({
      code: "E_CREDENTIAL_MISSING",
    });
  });

  it("reads the preview kind for a preview, so a primary-only secret does not count", async () => {
    const config = project({ "google.json": googleBody() });
    const getVariables = vi.fn(async (params: { kind?: string }) => {
      if (params.kind === "preview") {
        return {};
      }
      return { GOOGLE_CLIENT_SECRET: { primary: SECRET } };
    });

    await expect(
      validateConnections(ctx(config, { mode: "preview", client: { getVariables } })),
    ).rejects.toMatchObject({ code: "E_CREDENTIAL_MISSING" });
  });

  it("suggests setting the missing credential for the preview kind", async () => {
    const config = project({ "google.json": googleBody() });

    await expect(validateConnections(ctx(config, { mode: "preview" }, {}))).rejects.toMatchObject({
      nextCommands: ["variable set GOOGLE_CLIENT_SECRET --secret --preview --env staging"],
    });
  });

  it("counts a credential the preview kind holds", async () => {
    const config = project({ "google.json": googleBody() });
    const getVariables = vi.fn(async (params: { kind?: string }) => {
      if (params.kind === "preview") {
        return { GOOGLE_CLIENT_SECRET: { preview: SECRET } };
      }
      return {};
    });

    await expect(
      validateConnections(ctx(config, { mode: "preview", client: { getVariables } })),
    ).resolves.toBeUndefined();
  });

  it("leaves the variable check to the deploy when a preview's token may not read them", async () => {
    const config = project({ "google.json": googleBody() });
    const getVariables = vi
      .fn()
      .mockRejectedValue(
        new ForbiddenError("Forbidden", { status: 403, url: "https://api.example/variables" }),
      );

    await expect(
      validateConnections(ctx(config, { mode: "preview", client: { getVariables } })),
    ).resolves.toBeUndefined();
  });

  it("fails a deploy whose token may not read the variables", async () => {
    const config = project({ "google.json": googleBody() });
    const getVariables = vi
      .fn()
      .mockRejectedValue(
        new ForbiddenError("Forbidden", { status: 403, url: "https://api.example/variables" }),
      );

    await expect(
      validateConnections(ctx(config, { client: { getVariables } })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a connection whose client_secret names a variable the project lacks", async () => {
    const config = project({ "google.json": googleBody() });

    await expect(validateConnections(ctx(config, {}, {}))).rejects.toMatchObject({
      code: "E_CREDENTIAL_MISSING",
    });
  });

  it("suggests publishing a missing variable in the environment the deploy addressed", async () => {
    const config = project({ "google.json": googleBody() });

    await expect(validateConnections(ctx(config, {}, {}))).rejects.toMatchObject({
      nextCommands: ["variable set GOOGLE_CLIENT_SECRET --secret --env staging"],
    });
  });

  it("refuses a client_secret held in a plain variable", async () => {
    const config = project({ "google.json": googleBody() });

    await expect(
      validateConnections(ctx(config, {}, { GOOGLE_CLIENT_SECRET: "plain" })),
    ).rejects.toThrow(/which is not a secret/);
  });

  it("refuses a client_id held in a secret variable", async () => {
    const config = project({
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
          config,
          {},
          { GOOGLE_CLIENT_ID: { secret: true }, GOOGLE_CLIENT_SECRET: { secret: true } },
        ),
      ),
    ).rejects.toThrow(/which is a secret/);
  });

  it("refuses a client_id and client_secret that name the same variable", async () => {
    const config = project({
      "google.json": googleBody({
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "${{ GOOGLE_CLIENT_SECRET }}",
          client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
          scopes: ["openid"],
        },
      }),
    });

    await expect(validateConnections(ctx(config, {}))).rejects.toThrow(
      /client_id and client_secret both name the variable GOOGLE_CLIENT_SECRET/,
    );
  });

  it("names the connection file in the refusal", async () => {
    const config = project({ "google-workspace.json": googleBody() });

    await expect(validateConnections(ctx(config, {}, {}))).rejects.toThrow(
      /\.zitadel\/idps\/google-workspace\.json/,
    );
  });

  it("names the file of a later connection by its place in the configuration", async () => {
    const config = project({
      "b-okta.json": googleBody({
        slug: "okta",
        oidc: {
          issuer: "https://acme.okta.com",
          client_id: "okta-client",
          client_secret: "${{ OKTA_CLIENT_SECRET }}",
          scopes: ["openid"],
        },
      }),
      "a-google.json": googleBody(),
    });

    await expect(validateConnections(ctx(config, {}))).rejects.toThrow(
      /\.zitadel\/idps\/b-okta\.json: client_secret names the variable OKTA_CLIENT_SECRET/,
    );
  });
});
