import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import {
  aSetUpApp,
  type ConnectionDocument,
  type ScaffoldedApp,
  type UserSchemaDocument,
} from "../helpers/project";

const platform = usePlatformMock();

/** Adds a field to the committed user schema, as a developer would. */
function addCompanyField(app: ScaffoldedApp): Promise<void> {
  return app.editUserSchema((schema) => {
    schema.properties.company = { type: "string", description: "Company name" };
  });
}

const GOOGLE = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

/** Drops the transition the platform requires on a login entry step. */
function breakTheLoginEntryStep(app: ScaffoldedApp): Promise<void> {
  return app.editLoginFlow((flow) => {
    delete flow.steps.find((step) => step.name === "identifier")?.transitions?.user_not_found;
  });
}

describe("plan", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still previews the pending edit", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);
        platform.isNotZitadel();

        const result = await app.plan();

        expect(result.total).toBeGreaterThan(0);
      });
    });

    describe("that is down", () => {
      it("still previews the pending edit", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);
        platform.isUnavailable();

        const result = await app.plan();

        expect(result.total).toBeGreaterThan(0);
      });
    });

    describe("that refuses connections", () => {
      it("still previews the pending edit", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);
        platform.refusesConnections();

        const result = await app.plan();

        expect(result.total).toBeGreaterThan(0);
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("has nothing to reconcile after setup", async () => {
        const app = await aSetUpApp();

        const result = await app.plan();

        expect(result).toReportNothingToDo();
      });

      it("reports an edit as pending", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);

        const result = await app.plan();

        expect(result.total).toBeGreaterThan(0);
      });

      it("previews without consuming the change it previewed", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);
        const first = await app.plan();

        const second = await app.plan();

        expect(second).toEqual(first);
      });

      it("refuses a flow the platform would reject", async () => {
        const app = await aSetUpApp();
        await breakTheLoginEntryStep(app);

        const result = await app.planAttempt();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toExplain(
          'entry step for purpose "login" must wire "user_not_found" transition',
        );
      });

      it("refuses it before apply can publish half of it", async () => {
        const app = await aSetUpApp();
        const published = await app.publishedFlow();
        await breakTheLoginEntryStep(app);

        await app.planAttempt();

        expect(await app.apply()).toFailWith("E_VALIDATION");
        expect(await app.publishedFlow()).toEqual(published);
      });

      it("is clean again once the flow is repaired", async () => {
        const app = await aSetUpApp();
        await breakTheLoginEntryStep(app);
        expect(await app.planAttempt()).toFailWith("E_VALIDATION");

        await app.editLoginFlow((flow) => {
          const entry = flow.steps.find((step) => step.name === "identifier");
          if (entry?.transitions) entry.transitions.user_not_found = { target: "register" };
        });

        expect(await app.plan()).toReportNothingToDo();
      });
    });

    describe("SSO configuration across files", () => {
      async function anAppWithGoogle(): Promise<ScaffoldedApp> {
        const app = await aSetUpApp();
        expect(await app.enableSso("google", GOOGLE)).toSucceed();
        return app;
      }

      /** The schema's sso block, or a failure that says the scaffold changed. */
      function ssoOf(schema: UserSchemaDocument) {
        const sso = schema["x-auth-methods"]?.sso;
        if (sso === undefined) {
          throw new Error("the schema has no sso block");
        }
        return sso;
      }

      describe("connection files", () => {
        async function anAppServingGoogle(): Promise<ScaffoldedApp> {
          const app = await anAppWithGoogle();
          expect(await app.apply()).toSucceed();
          return app;
        }

        it("stops on two files that claim the same slug", async () => {
          const app = await anAppWithGoogle();
          await app.copyConnection("google", "copy");

          expect(await app.planAttempt()).toFailWith("E_VALIDATION");
        });

        it.each([
          [
            "slug",
            (c: ConnectionDocument) => {
              c.slug = "google2";
            },
          ],
          [
            "oidc.issuer",
            (c: ConnectionDocument) => {
              c.oidc.issuer = "https://other.test";
            },
          ],
          [
            "subject_claim",
            (c: ConnectionDocument) => {
              c.subject_claim = "email";
            },
          ],
          [
            "protocol",
            (c: ConnectionDocument) => {
              c.protocol = "oauth2";
            },
          ],
        ])("refuses an edit of %s on a connection already applied", async (_field, edit) => {
          const app = await anAppServingGoogle();
          await app.editConnection("google", edit);

          expect(await app.planAttempt()).toFailWith("E_VALIDATION");
        });

        it("plans an edit of a field that does not identify the connection", async () => {
          const app = await anAppServingGoogle();
          await app.editConnection("google", (connection) => {
            connection.display_name = "Google Workspace";
          });

          expect((await app.plan()).updates).toBe(1);
        });

        it.each(["GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_ID"])(
          "stops on a missing %s variable",
          async (name) => {
            const app = await anAppWithGoogle();
            expect(await app.deleteVariable(name)).toSucceed();

            expect(await app.planAttempt()).toFailWith("E_CREDENTIAL_MISSING");
          },
        );

        async function anAppServingAnUnlistedConnection(): Promise<ScaffoldedApp> {
          const app = await anAppServingGoogle();
          await app.addUnlistedConnection("spare");
          expect(await app.apply()).toSucceed();
          return app;
        }

        it("plans no deletion for a removed connection file", async () => {
          const app = await anAppServingAnUnlistedConnection();
          await app.removeConnection("spare");

          expect((await app.plan()).deletes).toBe(0);
        });

        it("names a removed connection file in the --json warnings", async () => {
          const app = await anAppServingAnUnlistedConnection();
          await app.removeConnection("spare");

          const { data } = app.envelopeOf<{ warnings: Array<{ rule: string }> }>(
            await app.planAttempt(),
          );

          expect(data.warnings.map(({ rule }) => rule)).toContain("unsupported-deletion");
        });

        it("does not re-check the variables of a connection that has not changed", async () => {
          const app = await anAppServingGoogle();
          expect(await app.deleteVariable("GOOGLE_CLIENT_SECRET")).toSucceed();

          expect(await app.planAttempt()).toSucceed();
        });

        it("stops when the project's variables cannot be listed", async () => {
          const app = await anAppServingGoogle();
          await app.editConnection("google", (connection) => {
            connection.display_name = "Google Workspace";
          });
          platform.cannotListVariables();

          expect(await app.planAttempt()).toFailWith("E_NETWORK");
        });

        it("stops on a client secret that is not a secret variable", async () => {
          const app = await anAppWithGoogle();
          expect(await app.setVariable("GOOGLE_CLIENT_SECRET", "plain")).toSucceed();

          expect(await app.planAttempt()).toFailWith("E_VALIDATION");
        });

        it("stops on a client id that is a secret variable", async () => {
          const app = await anAppWithGoogle();
          expect(await app.setVariable("GOOGLE_CLIENT_ID", "an-id", { secret: true })).toSucceed();

          expect(await app.planAttempt()).toFailWith("E_VALIDATION");
        });

        it("reports a removed connection file apart from the changes, in --json", async () => {
          const app = await anAppServingAnUnlistedConnection();
          await app.removeConnection("spare");

          const { data } = app.envelopeOf<{ total: number; unsupported_deletions: number }>(
            await app.planAttempt(),
          );

          expect(data).toMatchObject({ total: 0, unsupported_deletions: 1 });
        });

        it("plans a renamed connection file as a move, not a create", async () => {
          const app = await anAppServingGoogle();
          await app.renameConnection("google", "google-main");

          const { data } = app.envelopeOf<{ changes: Array<{ action: string }> }>(
            await app.planAttempt(),
          );

          expect(data.changes.map((change) => change.action)).toEqual(["move"]);
        });

        it("does not ask to restore the file a rename left behind", async () => {
          const app = await anAppServingGoogle();
          await app.renameConnection("google", "google-main");

          const { data } = app.envelopeOf<{ warnings: Array<{ rule: string }> }>(
            await app.planAttempt(),
          );

          expect(data.warnings.map(({ rule }) => rule)).not.toContain("unsupported-deletion");
        });

        it("stops on an edited connection whose stored copy cannot be read", async () => {
          const app = await anAppServingGoogle();
          await app.editConnection("google", (connection) => {
            connection.display_name = "Google Workspace";
          });
          platform.cannotReadConnections();

          expect(await app.planAttempt()).toFailWith("E_NETWORK");
        });

        it("names a removed connection file when rendered for a terminal", async () => {
          const app = await anAppServingAnUnlistedConnection();
          await app.removeConnection("spare");

          const result = await app.planRendered();

          expect(result).toPrint(app.connectionFile("spare"));
        });

        it("stops on an edited issuer even when the file was renamed in the same change", async () => {
          const app = await anAppServingGoogle();
          await app.renameConnection("google", "google-main");
          await app.editConnection("google-main", (connection) => {
            connection.oidc.issuer = "https://other.test";
          });

          expect(await app.planAttempt()).toFailWith("E_VALIDATION");
        });

        it("stops on two connections that share a variable", async () => {
          const app = await anAppWithGoogle();
          await app.copyConnection("google", "spare");
          await app.editConnection("spare", (connection) => {
            connection.slug = "spare";
          });

          expect(await app.planAttempt()).toFailWith("E_VALIDATION");
        });

        it("stops on a removed connection file a schema still lists", async () => {
          const app = await anAppServingGoogle();
          await app.removeConnection("google");

          expect(await app.planAttempt()).toFailWith("E_VALIDATION");
        });
      });

      it("accepts what sso enable writes", async () => {
        const app = await anAppWithGoogle();

        expect(await app.planAttempt()).toSucceed();
      });

      it("stops on a step that offers a provider the schema does not list", async () => {
        const app = await anAppWithGoogle();
        await app.editUserSchema((schema) => {
          ssoOf(schema).providers = ["okta"];
        });

        const result = await app.planAttempt();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toPrint("default-login.json");
      });

      it("stops on a step that offers providers when the schema has sso off", async () => {
        const app = await anAppWithGoogle();
        await app.editUserSchema((schema) => {
          ssoOf(schema).enabled = false;
        });

        const result = await app.planAttempt();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toPrint("identifier");
      });

      it("stops on a schema that lists a provider with no connection file", async () => {
        const app = await anAppWithGoogle();
        await app.editUserSchema((schema) => {
          ssoOf(schema).providers?.push("okta");
        });

        const result = await app.planAttempt();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toPrint("okta");
      });

      it("stops on a step that does not route every outcome", async () => {
        const app = await anAppWithGoogle();
        await app.editLoginFlow((flow) => {
          const transitions = flow.steps.find((step) => step.name === "identifier")?.transitions;
          if (transitions === undefined) {
            throw new Error("the identifier step has no transitions");
          }
          delete transitions.sso_user_not_found;
        });

        const result = await app.planAttempt();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toPrint("sso_user_not_found");
      });

      it("stops on a claim mapping to a property no schema defines", async () => {
        const app = await anAppWithGoogle();
        await app.editConnection("google", (connection) => {
          connection.claim_mapping = { email: "email", emailAddress: "mail" };
        });

        const result = await app.planAttempt();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toPrint("emailAddress");
      });

      it("stops on a verified claim that is not mapped", async () => {
        const app = await anAppWithGoogle();
        await app.editConnection("google", (connection) => {
          connection.verified_claims = { givenName: "given_name_verified" };
        });

        const result = await app.planAttempt();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toPrint("givenName");
      });

      it("stops on a claim mapping that fills nothing", async () => {
        const app = await anAppWithGoogle();
        await app.editConnection("google", (connection) => {
          connection.claim_mapping = {};
        });

        const result = await app.planAttempt();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toPrint("google.json");
      });

      it("names every problem at once", async () => {
        const app = await anAppWithGoogle();
        await app.editUserSchema((schema) => {
          ssoOf(schema).providers?.push("okta");
        });
        await app.editConnection("google", (connection) => {
          connection.claim_mapping = { email: "email", emailAddress: "mail" };
        });

        const result = await app.planAttempt();

        expect(result).toPrint("okta");
        expect(result).toPrint("emailAddress");
      });
    });

    describe("rendered for a terminal", () => {
      it("names the edited field", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);

        const result = await app.planRendered();

        expect(result).toPrint("company");
      });
      it("says a new revision will be published and the flow re-pinned", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);

        const result = await app.planRendered();

        expect(result).toPrint("will publish a new revision");
        expect(result).toPrint("user_schema will be re-pinned to the new revision");
      });
      it("does not report fields the server echoes back as changes", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);

        const result = await app.planRendered();

        expect(result).not.toPrint("audience");
        expect(result).not.toPrint("x-audit");
      });
    });
  });
});
