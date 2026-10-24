import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ConnectionDocument, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

/** A flow whose captcha gate reads its secret from the environment. */
const FLOW_NEEDING_A_CAPTCHA_SECRET = {
  name: "default",
  status: "active",
  user_schema:
    "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml",
  purposes: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      fields: [],
      actions: [{ name: "submit", kind: "submit", primary: true }],
      transitions: { submit: { target: "done" } },
      gates: {
        captcha: {
          kind: "captcha",
          provider: "altcha",
          config: { client_secret_env: "MY_CAPTCHA_SECRET" },
        },
      },
    },
    { name: "done", complete: "show" },
  ],
};

/** Adds a field and uses it in the register step, the combined-edit case. */
async function addCompanyFieldAndUseIt(app: ScaffoldedApp): Promise<void> {
  await app.editUserSchema((schema) => {
    schema.properties.company = { type: "string" };
  });
  await app.editLoginFlow((flow) => {
    flow.steps.find((step) => step.name === "register")?.fields?.push("company");
  });
}

describe("apply", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        await addCompanyFieldAndUseIt(app);
        platform.isNotZitadel();

        const result = await app.apply();

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        await addCompanyFieldAndUseIt(app);
        platform.isUnavailable();

        const result = await app.apply();

        expect(result).toFailWith("E_NETWORK");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        await addCompanyFieldAndUseIt(app);
        platform.refusesConnections();

        const result = await app.apply();

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    describe("an SSO configuration that does not hold together", () => {
      it("sends nothing, so the platform is left exactly as it was", async () => {
        const app = await aSetUpApp();
        expect(
          await app.enableSso("google", { clientId: "1234-abc", secret: "the-client-secret" }),
        ).toSucceed();
        await app.editConnection("google", (connection) => {
          connection.claim_mapping = { email: "email", emailAddress: "mail" };
        });

        const before = {
          schemas: await app.publishedSchemas(),
          flows: await app.publishedFlows(),
        };

        const result = await app.apply();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toPrint("emailAddress");
        expect(await app.registeredIdps()).toEqual([]);
        expect(await app.publishedSchemas()).toEqual(before.schemas);
        expect(await app.publishedFlows()).toEqual(before.flows);
      });
    });

    describe("an SSO configuration that only warns", () => {
      it("applies it, warning but not stopping, on a verification of a property nothing reads", async () => {
        const app = await aSetUpApp();
        expect(
          await app.enableSso("google", { clientId: "1234-abc", secret: "the-client-secret" }),
        ).toSucceed();
        await app.editUserSchema((schema) => {
          schema.properties.nickname = { type: "string" };
        });
        await app.editConnection("google", (connection) => {
          connection.claim_mapping = { ...connection.claim_mapping, nickname: "nickname" };
          connection.verified_claims = { ...connection.verified_claims, nickname: "nickname_ok" };
        });

        const result = await app.apply();

        expect(result).toSucceed();
        expect(result).toSay("not unique");
      });
    });

    describe("a connection file removed after it was applied", () => {
      /** A set-up project with a connection no schema lists, applied, then its file removed. */
      async function aProjectThatRemovedAConnection(): Promise<ScaffoldedApp> {
        const app = await aSetUpApp();
        await app.enableSso("google", { clientId: "1234-abc", secret: "the-client-secret" });
        await app.addUnlistedConnection("spare");
        await app.apply();
        await app.removeConnection("spare");
        return app;
      }

      it("leaves the connection registered", async () => {
        const app = await aProjectThatRemovedAConnection();

        await app.apply();

        expect((await app.registeredIdps()).map((idp) => idp.slug)).toContain("spare");
      });

      it("names the file in the output", async () => {
        const app = await aProjectThatRemovedAConnection();

        const result = await app.apply();

        expect(result).toSay(app.connectionFile("spare"));
      });

      it("lists the kept removal apart from what it applied", async () => {
        const app = await aProjectThatRemovedAConnection();

        const result = await app.apply();

        const { data } = app.envelopeOf<{ unsupported_deletion_files: string[] }>(result);
        expect(data.unsupported_deletion_files).toEqual([app.connectionFile("spare")]);
      });

      it("does not say everything is in sync", async () => {
        const app = await aProjectThatRemovedAConnection();

        const result = await app.apply();

        const { data } = app.envelopeOf<{ next_actions: string[] }>(result);
        expect(data.next_actions.join(" ")).not.toContain("already in sync");
      });
    });

    describe("a connection file renamed after it was applied", () => {
      /** Google applied, then its file renamed without touching its contents. */
      async function aRenamedApp(): Promise<ScaffoldedApp> {
        const app = await aSetUpApp();
        await app.enableSso("google", { clientId: "1234-abc", secret: "the-client-secret" });
        await app.apply();
        await app.renameConnection("google", "google-main");
        return app;
      }

      it("is reported as a move, not a create", async () => {
        const app = await aRenamedApp();

        const result = await app.apply();

        const { data } = app.envelopeOf<{ changes: Array<{ action: string }> }>(result);
        expect(data.changes.map((change) => change.action)).toEqual(["move"]);
      });

      it("says where it moved from", async () => {
        const app = await aRenamedApp();

        const result = await app.apply();

        const { data } = app.envelopeOf<{ changes: Array<{ moved_from?: string }> }>(result);
        expect(data.changes.map((change) => change.moved_from)).toEqual([
          app.connectionFile("google"),
        ]);
      });

      it("leaves no removed file kept", async () => {
        const app = await aRenamedApp();

        const result = await app.apply();

        expect(
          app.envelopeOf<{ unsupported_deletion_files: string[] }>(result).data
            .unsupported_deletion_files,
        ).toEqual([]);
      });

      it("leaves nothing to reconcile", async () => {
        const app = await aRenamedApp();
        await app.apply();

        expect(await app.plan()).toReportNothingToDo();
      });

      it("keeps the connection registered once", async () => {
        const app = await aRenamedApp();
        await app.apply();

        expect((await app.registeredIdps()).map((idp) => idp.slug)).toEqual(["google"]);
      });
    });

    describe("a connection claimed by two files", () => {
      it("sends nothing", async () => {
        const app = await aSetUpApp();
        expect(
          await app.enableSso("google", { clientId: "1234-abc", secret: "the-client-secret" }),
        ).toSucceed();
        await app.copyConnection("google", "copy");

        const result = await app.apply();

        expect(result).toFailWith("E_VALIDATION");
        expect(await app.registeredIdps()).toEqual([]);
      });
    });

    describe("an edit to what identifies a connection", () => {
      it.each([
        [
          "slug",
          (connection: ConnectionDocument) => {
            connection.slug = "google2";
          },
        ],
        [
          "oidc.issuer",
          (connection: ConnectionDocument) => {
            connection.oidc.issuer = "https://other.test";
          },
        ],
        [
          "subject_claim",
          (connection: ConnectionDocument) => {
            connection.subject_claim = "oid";
          },
        ],
      ])("to the %s is refused and leaves the platform as it was", async (_field, edit) => {
        const app = await aSetUpApp();
        expect(
          await app.enableSso("google", { clientId: "1234-abc", secret: "the-client-secret" }),
        ).toSucceed();
        expect(await app.apply()).toSucceed();
        const before = await app.registeredIdps();
        await app.editConnection("google", edit);

        const result = await app.apply();

        expect(result).toFailWith("E_VALIDATION");
        expect(await app.registeredIdps()).toEqual(before);
      });
    });

    describe("a connection whose client_id variable is missing", () => {
      it("stops before sending anything", async () => {
        const app = await aSetUpApp();
        expect(
          await app.enableSso("google", { clientId: "1234-abc", secret: "the-client-secret" }),
        ).toSucceed();
        expect(await app.deleteVariable("GOOGLE_CLIENT_ID")).toSucceed();

        const result = await app.apply();

        expect(result).toFailWith("E_CREDENTIAL_MISSING");
        expect(await app.registeredIdps()).toEqual([]);
      });
    });

    describe("a connection whose client_secret variable is missing", () => {
      it("stops before sending anything", async () => {
        const app = await aSetUpApp();
        expect(
          await app.enableSso("google", { clientId: "1234-abc", secret: "the-client-secret" }),
        ).toSucceed();
        expect(await app.deleteVariable("GOOGLE_CLIENT_SECRET")).toSucceed();

        const result = await app.apply();

        expect(result).toFailWith("E_CREDENTIAL_MISSING");
        expect(result).toPrint("GOOGLE_CLIENT_SECRET");
        expect(await app.registeredIdps()).toEqual([]);
      });
    });

    describe("--json", () => {
      it("reports a project that already matches as synced", async () => {
        const app = await aSetUpApp();

        const result = await app.apply();

        expect(app.envelopeOf<{ synced: boolean }>(result).data.synced).toBe(true);
      });

      it("publishes a new schema revision for an edited schema", async () => {
        const app = await aSetUpApp();
        const before = await app.publishedSchema();
        await addCompanyFieldAndUseIt(app);

        expect(await app.apply()).toSucceed();

        const after = await app.publishedSchema();
        expect(after.id).not.toBe(before.id);
      });

      it("carries the edit into the published schema", async () => {
        const app = await aSetUpApp();
        await addCompanyFieldAndUseIt(app);

        expect(await app.apply()).toSucceed();

        expect((await app.publishedSchema()).schema.properties).toHaveProperty("company");
      });

      it("keeps the published flow naming the schema by objectType", async () => {
        const app = await aSetUpApp();
        await addCompanyFieldAndUseIt(app);

        expect(await app.apply()).toSucceed();

        expect((await app.publishedFlow()).flow_definition.user_schema).toBe("human-user");
      });

      it("leaves nothing to reconcile after a combined edit", async () => {
        const app = await aSetUpApp();
        await addCompanyFieldAndUseIt(app);

        expect(await app.apply()).toSucceed();

        expect(await app.plan()).toReportNothingToDo();
      });

      it("refuses a flow whose gate needs an environment variable that is not set", async () => {
        const app = await aSetUpApp();
        await app.addFlow("default", FLOW_NEEDING_A_CAPTCHA_SECRET);

        const result = await app.apply();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toExplain("Missing environment variables");
      });

      it("accepts that flow once the variable is set", async () => {
        const app = await aSetUpApp();
        await app.addFlow("default", FLOW_NEEDING_A_CAPTCHA_SECRET);

        const result = await app.run(["apply", "--non-interactive", "--json"], {
          MY_CAPTCHA_SECRET: "hunter2",
        });

        expect(result).toSucceed();
      });
    });

    it("changes nothing on a dry run", async () => {
      const app = await aSetUpApp();
      await addCompanyFieldAndUseIt(app);
      const published = await app.publishedSchema();
      const before = await app.snapshot();

      const result = await app.apply(["--dry-run"]);

      expect(result).toSucceed();
      expect(await app.publishedSchema()).toEqual(published);
      expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
    });
  });
});
