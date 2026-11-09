import { DEFAULT_FLOW_CONFIG_PATH, DEFAULT_SCHEMA_CONFIG_PATH } from "@zitadel/config/defaults";
import { describe, expect, it } from "vitest";

import { acmeSelection, googleSelection } from "@tests/helpers/idp-values";
import { thrownBy } from "@tests/helpers/thrown-value";
import { PASSWORD_POLICY_PATH } from "@/lib/policies";
import {
  CONFIG_DIRECTORIES,
  ConfigError,
  ConflictError,
  ConnectionExistsError,
  FileExistsError,
  MemoryStore,
  ZitadelConfig,
} from "@/lib/zitadel";

describe("ZitadelConfig.scaffold", () => {
  describe("with no provider", () => {
    it("writes the default schema, the default flow and the password policy", () => {
      const scaffold = ZitadelConfig.empty().scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [],
        force: false,
      });

      expect(scaffold.change.changedPaths).toEqual([
        DEFAULT_SCHEMA_CONFIG_PATH,
        DEFAULT_FLOW_CONFIG_PATH,
        PASSWORD_POLICY_PATH,
      ]);
    });

    it("names the schema by its objectType on the flow", () => {
      const { schema, flow } = ZitadelConfig.empty().scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [],
        force: false,
      });

      expect(flow.userSchema).toBe(schema.objectType);
    });

    it("leaves SSO off the schema", () => {
      const { schema } = ZitadelConfig.empty().scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [],
        force: false,
      });

      expect(schema.ssoEnabled).toBe(false);
    });

    it("offers no provider on the flow", () => {
      const { flow } = ZitadelConfig.empty().scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [],
        force: false,
      });

      expect(flow.offers()).toBe(false);
    });
  });

  describe("with the business use case", () => {
    it("adds companyName to the schema", () => {
      const { schema } = ZitadelConfig.empty().scaffold({
        preset: "password-first",
        useCase: "business",
        sso: [],
        force: false,
      });

      expect(schema.propertyNames).toContain("companyName");
    });

    it("asks for companyName on the register step", () => {
      const { flow } = ZitadelConfig.empty().scaffold({
        preset: "password-first",
        useCase: "business",
        sso: [],
        force: false,
      });

      expect(flow.step("register")?.fields).toEqual([
        "email",
        "givenName",
        "familyName",
        "companyName",
      ]);
    });
  });

  describe("with a password minimum", () => {
    it.each([
      { given: undefined, minimum: 15 },
      { given: 12, minimum: 12 },
      { given: null, minimum: undefined },
    ])("holds $minimum when $given was given", ({ given, minimum }) => {
      const { policy } = ZitadelConfig.empty().scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [],
        passwordMinLength: given,
        force: false,
      });

      expect(policy.body.config.min_length).toBe(minimum);
    });
  });

  describe("with providers", () => {
    it("writes a connection per provider", () => {
      const scaffold = ZitadelConfig.empty().scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [{ selection: googleSelection }, { selection: acmeSelection }],
        force: false,
      });

      expect(scaffold.change.changedPaths).toEqual(
        expect.arrayContaining([
          `${CONFIG_DIRECTORIES.connections}/google.json`,
          `${CONFIG_DIRECTORIES.connections}/acme.json`,
        ]),
      );
    });

    it("hands back each provider with its connection, in the order chosen", () => {
      const { connections } = ZitadelConfig.empty().scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [{ selection: googleSelection }, { selection: acmeSelection }],
        force: false,
      });

      expect(
        connections.map(({ chosen, connection }) => {
          return [chosen.selection, connection.name];
        }),
      ).toEqual([
        [googleSelection, "google"],
        [acmeSelection, "acme"],
      ]);
    });

    it("lists every provider on the schema, in the order chosen", () => {
      const { schema } = ZitadelConfig.empty().scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [{ selection: googleSelection }, { selection: acmeSelection }],
        force: false,
      });

      expect(schema.providers).toEqual(["google", "acme"]);
    });

    it("offers every provider on the identifier step, in the order chosen", () => {
      const { flow } = ZitadelConfig.empty().scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [{ selection: googleSelection }, { selection: acmeSelection }],
        force: false,
      });

      expect(flow.step("identifier")?.providers).toEqual(["google", "acme"]);
    });

    it("writes the client secret as a variable reference, never a value", () => {
      const { connections } = ZitadelConfig.empty().scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [{ selection: googleSelection }],
        force: false,
      });

      expect(connections[0]?.connection.credentialNames.clientSecret).toBe("GOOGLE_CLIENT_SECRET");
    });
  });

  describe("when a default file is already there", () => {
    it.each([DEFAULT_SCHEMA_CONFIG_PATH, DEFAULT_FLOW_CONFIG_PATH, PASSWORD_POLICY_PATH])(
      "refuses %s without force",
      async (path) => {
        const store = new MemoryStore([
          { path: DEFAULT_SCHEMA_CONFIG_PATH, body: {} },
          { path: DEFAULT_FLOW_CONFIG_PATH, body: {} },
          { path: PASSWORD_POLICY_PATH, body: {} },
        ].filter((file) => {
          return file.path === path;
        }));
        const config = await ZitadelConfig.loadUnchecked(store);

        const error = thrownBy(() => {
          return config.scaffold({
            preset: "password-first",
            useCase: "minimal",
            sso: [],
            force: false,
          });
        });

        expect(error).toBeInstanceOf(FileExistsError);
        expect(error).toMatchObject({ path });
      },
    );

    it("replaces the default schema and flow under force", async () => {
      const store = new MemoryStore([
        { path: DEFAULT_SCHEMA_CONFIG_PATH, body: { objectType: "old" } },
        { path: DEFAULT_FLOW_CONFIG_PATH, body: { name: "old" } },
      ]);
      const config = await ZitadelConfig.loadUnchecked(store);
      const scaffold = config.scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [],
        force: true,
      });

      await scaffold.change.save(store, { overwrite: true });

      expect([store.get(DEFAULT_SCHEMA_CONFIG_PATH), store.get(DEFAULT_FLOW_CONFIG_PATH)]).toEqual([
        scaffold.schema.body,
        scaffold.flow.body,
      ]);
    });
  });

  describe("when force keeps a password policy", () => {
    it("leaves a policy given no minimum unwritten", async () => {
      const store = new MemoryStore([
        {
          path: PASSWORD_POLICY_PATH,
          body: { operation: "auth.factor.password.set", config: { min_length: 9 } },
        },
      ]);
      const config = await ZitadelConfig.loadUnchecked(store);

      const scaffold = config.scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [],
        force: true,
      });

      expect(scaffold.change.changedPaths).not.toContain(PASSWORD_POLICY_PATH);
    });

    it("leaves a policy given the minimum it already holds unwritten", async () => {
      const store = new MemoryStore([
        {
          path: PASSWORD_POLICY_PATH,
          body: { operation: "auth.factor.password.set", config: { min_length: 9 } },
        },
      ]);
      const config = await ZitadelConfig.loadUnchecked(store);

      const scaffold = config.scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [],
        passwordMinLength: 9,
        force: true,
      });

      expect(scaffold.change.changedPaths).not.toContain(PASSWORD_POLICY_PATH);
    });

    it.each([
      { given: 20, config: { max_length: 64, min_length: 20 } },
      { given: null, config: { max_length: 64 } },
    ])("puts a minimum of $given into it, keeping its other settings", async ({ given, config }) => {
      const store = new MemoryStore([
        {
          path: PASSWORD_POLICY_PATH,
          body: {
            operation: "auth.factor.password.set",
            config: { max_length: 64, min_length: 9 },
          },
        },
      ]);
      const loaded = await ZitadelConfig.loadUnchecked(store);

      const { policy } = loaded.scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [],
        passwordMinLength: given,
        force: true,
      });

      expect(policy.body.config).toEqual(config);
    });

    it("refuses one that is not a valid password policy", async () => {
      const store = new MemoryStore([
        { path: PASSWORD_POLICY_PATH, body: { operation: "auth.factor.other" } },
      ]);
      const config = await ZitadelConfig.loadUnchecked(store);

      const error = thrownBy(() => {
        return config.scaffold({
          preset: "password-first",
          useCase: "minimal",
          sso: [],
          force: true,
        });
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({ details: { file: PASSWORD_POLICY_PATH } });
    });
  });

  describe("when a chosen provider already has a connection", () => {
    it.each([false, true])("refuses its file with force %s", async (force) => {
      const store = new MemoryStore([
        {
          path: `${CONFIG_DIRECTORIES.connections}/google.json`,
          body: { slug: "google", template: "google" },
        },
      ]);
      const config = await ZitadelConfig.loadUnchecked(store);

      const error = thrownBy(() => {
        return config.scaffold({
          preset: "password-first",
          useCase: "minimal",
          sso: [{ selection: googleSelection }],
          force,
        });
      });

      expect(error).toBeInstanceOf(ConnectionExistsError);
      expect(error).toMatchObject({
        path: `${CONFIG_DIRECTORIES.connections}/google.json`,
        selection: googleSelection,
      });
    });

    it("refuses one another file holds, naming that file", async () => {
      const store = new MemoryStore([
        {
          path: `${CONFIG_DIRECTORIES.connections}/elsewhere.json`,
          body: { slug: "google", template: "google" },
        },
      ]);
      const config = await ZitadelConfig.loadUnchecked(store);

      const error = thrownBy(() => {
        return config.scaffold({
          preset: "password-first",
          useCase: "minimal",
          sso: [{ selection: googleSelection }],
          force: false,
        });
      });

      expect(error).toBeInstanceOf(ConnectionExistsError);
      expect(error).toMatchObject({ path: `${CONFIG_DIRECTORIES.connections}/elsewhere.json` });
    });

    it("refuses one that connects to another issuer, saying to choose another slug", async () => {
      const store = new MemoryStore([
        {
          path: `${CONFIG_DIRECTORIES.connections}/acme.json`,
          body: { slug: "acme", oidc: { issuer: "https://sso.other.example" } },
        },
      ]);
      const config = await ZitadelConfig.loadUnchecked(store);

      const error = thrownBy(() => {
        return config.scaffold({
          preset: "password-first",
          useCase: "minimal",
          sso: [{ selection: acmeSelection }],
          force: false,
        });
      });

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({
        hint: expect.stringContaining("Choose another slug for this connection"),
      });
    });
  });

  describe("when another connection uses a chosen provider's variables", () => {
    it("refuses the provider", async () => {
      const store = new MemoryStore([
        {
          path: `${CONFIG_DIRECTORIES.connections}/other.json`,
          body: {
            slug: "other",
            oidc: {
              issuer: "https://other.example",
              client_id: "${{ ACME_CLIENT_ID }}",
              client_secret: "${{ OTHER_CLIENT_SECRET }}",
            },
          },
        },
      ]);
      const config = await ZitadelConfig.loadUnchecked(store);

      const error = thrownBy(() => {
        return config.scaffold({
          preset: "password-first",
          useCase: "minimal",
          sso: [{ selection: acmeSelection }],
          force: false,
        });
      });

      expect(error).toBeInstanceOf(ConflictError);
    });
  });

  describe("when a connection is there for a provider nobody chose", () => {
    it("leaves it alone", async () => {
      const store = new MemoryStore([
        {
          path: `${CONFIG_DIRECTORIES.connections}/acme.json`,
          body: { slug: "acme", oidc: { issuer: "https://sso.acme.example" } },
        },
      ]);
      const config = await ZitadelConfig.loadUnchecked(store);

      const scaffold = config.scaffold({
        preset: "password-first",
        useCase: "minimal",
        sso: [{ selection: googleSelection }],
        force: false,
      });

      expect(scaffold.change.changedPaths).not.toContain(
        `${CONFIG_DIRECTORIES.connections}/acme.json`,
      );
    });
  });
});
