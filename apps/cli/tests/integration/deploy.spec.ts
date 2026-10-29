import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import {
  aCommittedApp,
  aSetUpApp,
  PASSWORD_POLICY,
  type ScaffoldedApp,
  SETUP_ORIGIN,
} from "../helpers/project";

const platform = usePlatformMock();

const GOOGLE = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

/** A set-up app with Google sign-in enabled, ready for a deploy. */
async function anAppWithGoogle(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  expect(await app.enableSso("google", GOOGLE)).toSucceed();
  return app;
}

/** A set-up app with a custom OIDC connection enabled, ready for a deploy. */
async function anAppWithCustomSso(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  expect(
    await app.enableCustomSso(
      { slug: "acme-sso", displayName: "Acme SSO", issuer: "https://sso.acme.example" },
      { clientId: "acme-client-id", secret: "acme-client-secret" },
    ),
  ).toSucceed();
  return app;
}

/** Mapping mistakes a deploy must refuse, each applied to a Google connection. */
const HARD_ERRORS: ReadonlyArray<[string, (app: ScaffoldedApp) => Promise<void>]> = [
  [
    "a mapping target the schema does not define",
    (app) =>
      app.editConnection("google", (c) => {
        c.claim_mapping = { ...c.claim_mapping, contactEmial: "mail" };
      }),
  ],
  [
    "a mapping key that contains a dot",
    (app) =>
      app.editConnection("google", (c) => {
        c.claim_mapping = { ...c.claim_mapping, "profile.email": "mail" };
      }),
  ],
  [
    "a standard claim the catalog connection's scopes do not return",
    (app) =>
      app.editConnection("google", (c) => {
        c.oidc.scopes = ["openid", "email"];
        c.claim_mapping = { ...c.claim_mapping, givenName: "given_name" };
      }),
  ],
  [
    "a claim whose type the property cannot hold",
    async (app) => {
      await app.editUserSchema((schema) => {
        schema.properties.refreshedAt = { type: "string" };
      });
      await app.editConnection("google", (c) => {
        c.claim_mapping = { ...c.claim_mapping, refreshedAt: "updated_at" };
      });
    },
  ],
  [
    "a verification that reads a claim which is not a boolean",
    (app) =>
      app.editConnection("google", (c) => {
        c.verified_claims = { email: "email" };
      }),
  ],
  [
    "a subject that is a claim the user can change",
    (app) =>
      app.editConnection("google", (c) => {
        c.subject_claim = "email";
      }),
  ],
];

describe("deploy", () => {
  describe("against an invalid server", () => {
    // deploy reaches the server to read the live release for the diff and to
    // create the release, so a server that cannot answer fails the command.
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.deploy();

        expect(result).toFail();
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.deploy();

        expect(result).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("deploys the config to every primary origin", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");

        const data = await app.deployData();

        expect(data.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(data.origins).toEqual([SETUP_ORIGIN.pattern, "https://app.acme.com"]);
      });

      it("re-deploys the same release when nothing changed", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const first = await app.deployData();

        const second = await app.deployData();

        expect(second.content_hash).toBe(first.content_hash);
      });

      it("publishes a policy file, and an edit of it as a new revision of the same policy", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        expect(await app.publish()).toSucceed();
        const [first] = await app.publishedPolicies();

        await app.writePasswordPolicy({ min_length: 14 });
        expect(await app.deploy()).toSucceed();

        const [edited] = await app.publishedPolicies();
        expect(first).toMatchObject({ operation: PASSWORD_POLICY, config: { min_length: 12 } });
        expect(edited).toMatchObject({ id: first?.id, config: { min_length: 14 } });
        expect(edited?.revision_id).not.toBe(first?.revision_id);
      });

      it("stops before sending a policy file with a value outside its bounds", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const before = await app.publishedPolicies();
        await app.writePasswordPolicy({ min_length: 0 });

        const result = await app.deploy();

        expect(result).toFailWith("E_VALIDATION");
        expect(await app.publishedPolicies()).toEqual(before);
      });

      it("stops before sending a policy file not named after its operation", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.writePasswordPolicy({ min_length: 12 }, { name: "password" });

        const result = await app.deploy();

        expect(result).toFailWith("E_VALIDATION");
      });

      it("is refused by the server for a policy whose settings contradict each other", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.writePasswordPolicy({ min_length: 20, max_length: 10 });

        const result = await app.deploy();

        expect(result).toFail();
        expect(result.stdout + result.stderr).toContain("pol.invalid");
      });

      it("requires -m when non-interactive", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const result = await app.run(["deploy", "--non-interactive", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("rejects a blank -m when non-interactive", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const result = await app.run(["deploy", "--non-interactive", "--json", "-m", "   "]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("fails when the project has no primary origin", async () => {
        const app = await aSetUpApp();
        await app.removeOrigin(SETUP_ORIGIN.pattern);

        const result = await app.deploy();

        expect(result).toFailWith("E_VALIDATION");
      });

      it("points a project whose issuer setup 0.1.0 registered as a preview origin at doctor --fix", async () => {
        const app = await aSetUpApp();
        await app.hasItsIssuerAsAPreviewOrigin();

        const result = await app.deploy();

        expect(result).toSuggest("doctor --fix");
      });

      it("checks for a primary origin before syncing IdP connections", async () => {
        const app = await aSetUpApp();
        await app.removeOrigin(SETUP_ORIGIN.pattern);
        // A connection the IdP step would create — were it reached. The project
        // has no primary origin, so the deploy must fail before the IdP step
        // writes anything, leaving no connection behind.
        await mkdir(join(app.path, ".zitadel/idps"), { recursive: true });
        await app.writeProjectFile(
          ".zitadel/idps/google.json",
          `${JSON.stringify(
            {
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
            },
            null,
            2,
          )}\n`,
        );

        const result = await app.deploy();

        expect(result).toFailWith("E_VALIDATION");
        expect(await app.registeredIdps()).toEqual([]);
      });

      it("registers a sign-in provider through the release, not before it", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.enableSso("google", {
          clientId: "1234-abc.apps.googleusercontent.com",
          secret: "the-client-secret",
        });

        await app.deployData();

        expect((await app.registeredIdps()).map((idp) => idp.slug)).toEqual(["google"]);
      });

      it("writes no connection when the deploy never reaches the release", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", {
          clientId: "1234-abc.apps.googleusercontent.com",
          secret: "the-client-secret",
        });
        await app.removeVariable("GOOGLE_CLIENT_SECRET");
        await app.removeOrigin(SETUP_ORIGIN.pattern);

        const result = await app.deploy();

        expect(result).toFail();
        expect(await app.registeredIdps()).toEqual([]);
      });

      it("refuses a connection whose secret variable the project does not hold", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.enableSso("google", {
          clientId: "1234-abc.apps.googleusercontent.com",
          secret: "the-client-secret",
        });
        await app.removeVariable("GOOGLE_CLIENT_SECRET");

        const result = await app.deploy();

        expect(result).toFailWith("E_CREDENTIAL_MISSING");
      });

      it("takes no --origin, as primary origins are never named one by one", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.example.com");

        const result = await app.deploy(["--origin", "https://app.example.com"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("omits the guard on a first deploy, when nothing is live", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        // Nothing is deployed yet, so there is no deployment to guard against.
        // The deploy must omit expected_deployment_id entirely: an empty or
        // placeholder id would be rejected by the request schema, so a
        // succeeding first deploy proves the field was left off.
        const data = await app.deployData();

        expect(data.deployment_id).toMatch(/^dep_/);
        const listed = await app.run(["deployment", "list", "--json"]);
        expect(app.envelopeOf<{ count: number }>(listed).data.count).toBe(1);
      });

      it("passes the observed deployment and re-deploys unchanged content", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const first = await app.deployData();

        // The second deploy observes the first as the live deployment and
        // sends it as expected_deployment_id; nothing changed, so the server
        // answers with the same release rather than a conflict.
        const second = await app.deployData();

        expect(second.content_hash).toBe(first.content_hash);
      });

      it("says a revoked release cannot be deployed rather than reporting a race", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const first = await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.one = { type: "string" };
        });
        await app.deployData();
        await app.run([
          "release",
          "revoke",
          first.release_id ?? "",
          "--force",
          "--non-interactive",
          "--json",
        ]);
        await app.editUserSchema((schema) => {
          delete schema.properties.one;
        });

        const result = await app.deploy();

        expect(result).toExplain("revoked");
      });

      it("fails with a conflict when another deploy lands first", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        platform.racesTheNextDeploy();

        const result = await app.deploy();

        expect(result).toFailWith("E_CONFLICT");
      });

      it("hints at re-running with a message when another deploy lands first", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        platform.racesTheNextDeploy();

        const result = await app.deploy();

        expect(result).toHintAt("deploy -m");
      });

      it("validates and writes nothing on a dry run", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const dry = await app.deployDryRun();

        expect(dry).toSucceed();
        const listed = await app.run(["deployment", "list", "--json"]);
        expect(app.envelopeOf<{ count: number }>(listed).data.count).toBe(0);
      });

      it("shows what a dry run would change since the live release", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.commit();
        await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.nickname = { type: "string" };
        });

        const data = await app.deployDryRunData();

        expect(data.diff?.files).toEqual([
          expect.objectContaining({
            status: "modified",
            patch: expect.stringContaining('"nickname"'),
          }),
        ]);
      });

      it("reports what a deploy changed since the release it replaced", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.commit();
        await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.nickname = { type: "string" };
        });

        const data = await app.deployData();

        expect(data.diff?.files).toEqual([
          expect.objectContaining({
            status: "modified",
            patch: expect.stringContaining('"nickname"'),
          }),
        ]);
      });
    });

    describe("SSO configuration across files", () => {
      describe("refuses a mapping that cannot work", () => {
        it.each(HARD_ERRORS)("deploy stops on %s", async (_name, edit) => {
          const app = await anAppWithGoogle();
          await edit(app);

          expect(await app.deploy()).toFailWith("E_VALIDATION");
        });

        it.each(HARD_ERRORS)("deploy --dry-run stops on %s", async (_name, edit) => {
          const app = await anAppWithGoogle();
          await edit(app);

          expect(await app.deployDryRun()).toFailWith("E_VALIDATION");
        });
      });

      it("suggests the property a mistyped mapping target was meant for", async () => {
        const app = await anAppWithGoogle();
        await app.editUserSchema((schema) => {
          schema.properties.contactEmail = { type: "string" };
        });
        await app.editConnection("google", (c) => {
          c.claim_mapping = { ...c.claim_mapping, contactEmial: "mail" };
        });

        expect(await app.deployDryRun()).toExplain('Did you mean "contactEmail"?');
      });

      it("lets a verification of a property nothing reads through", async () => {
        const app = await anAppWithGoogle();
        await app.editUserSchema((schema) => {
          schema.properties.nickname = { type: "string" };
        });
        await app.editConnection("google", (c) => {
          c.claim_mapping = { ...c.claim_mapping, nickname: "nickname" };
          c.verified_claims = { ...c.verified_claims, nickname: "nickname_ok" };
        });

        expect(await app.deployDryRun()).toSucceed();
      });

      it("lets a custom connection whose scopes omit a claim it reads through", async () => {
        const app = await anAppWithCustomSso();
        await app.editConnection("acme-sso", (c) => {
          c.oidc.scopes = ["openid"];
        });

        expect(await app.deployDryRun()).toSucceed();
      });

      it("warns that a custom connection reads a claim its scopes do not return", async () => {
        const app = await anAppWithCustomSso();
        await app.editConnection("acme-sso", (c) => {
          c.oidc.scopes = ["openid"];
        });

        expect(await app.deployRendered(["--dry-run"])).toSay("only returns for");
      });

      it("prints the mapping box for each connection on a dry run", async () => {
        const app = await anAppWithGoogle();

        expect(await app.deployRendered(["--dry-run"])).toPrint("SIGN IN WITH GOOGLE");
      });

      it("names an attribute the connection leaves without a claim", async () => {
        const app = await aSetUpApp(["--use-case", "business"]);
        expect(await app.enableSso("google", GOOGLE)).toSucceed();

        expect(await app.deployRendered(["--dry-run"])).toPrint("companyName");
      });

      it("names the schema that signs in through the connection", async () => {
        const app = await anAppWithGoogle();

        expect(await app.deployRendered(["--dry-run"])).toPrint(
          "default-human-user signs in through this connection",
        );
      });
    });

    describe("rendered for a terminal", () => {
      it("says what it deployed", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");

        const result = await app.deployRendered();

        expect(result).toPrint("Deployed sha256:");
      });

      it("has no baseline to diff against on the first deploy", async () => {
        const app = await aCommittedApp();

        const result = await app.deployRendered();

        expect(result).toPrint("No diff available");
      });

      it("diffs against the commit the live release was built from", async () => {
        const app = await aCommittedApp();
        await app.deployRendered();
        await app.editUserSchema((schema) => {
          schema.properties.nickname = { type: "string" };
        });
        await app.commitEverything();

        const result = await app.deployRendered();

        expect(result).toPrint("nickname");
      });

      it("reports a clean tree as no change rather than no diff", async () => {
        const app = await aCommittedApp();
        await app.deployRendered();

        const result = await app.deployRendered();

        expect(result).toPrint("No changes to .zitadel/ since");
      });
    });
  });
});
