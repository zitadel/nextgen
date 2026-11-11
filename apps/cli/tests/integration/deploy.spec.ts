import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import {
  aCommittedApp,
  anUndeployedEnvironment,
  aSetUpApp,
  type DeployResult,
  PASSWORD_POLICY,
  SETUP_ORIGIN,
} from "@tests/helpers/project";

const platform = usePlatformMock();

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
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      await app.addPrimaryOrigin();
      platform.servesAHostileOrigin();
      platform.buildsAReleaseWithAHostileHash();
      const args = ["deploy", "-m", "in every rendering"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

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

      it("names the schema the server refused, and why", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.rejectsASchema();

        const result = await app.deploy();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toHintAt(
          'schema human-user: schema designation invalid: "x-display" names unknown property "nickname"',
        );
      });

      it("names the flow the server refused, and why", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.rejectsAFlow();

        const result = await app.deploy();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toHintAt(
          'flow default-login: flow definition: invalid: step "register-password": on_success create_user requires "identifier"',
        );
      });

      it("names the field the server refused to change on a connection", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.rejectsAConnection();

        const result = await app.deploy();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toHintAt(
          "idp google: identity provider connection: the field is fixed for the life of the connection: oidc.issuer",
        );
      });

      it("does not warn about the scaffolded login flow", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result).warnings ?? []).toEqual([]);
      });

      it("warns when the login path reaches a password step with no identifier before it", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.editLoginEntryStep((step) => {
          step.fields = [];
        });

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result).warnings?.join("\n")).toContain(
          'step "password" collects x-auth-methods#password on the login path',
        );
      });

      it("warns that users without the identifier cannot sign in", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();

        const result = await app.deployDryRun(["--force"]);

        expect(app.envelopeOf(result).warnings?.join("\n")).toContain(
          '1 of 1 existing user of "human-user" has no "email"',
        );
      });

      it("warns about a missing identifier the login path reaches through a passkey-first start", async () => {
        const app = await aSetUpApp(["--preset", "passkey-first"]);
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();

        const result = await app.deployDryRun(["--force"]);

        expect(app.envelopeOf(result).warnings?.join("\n")).toContain(
          '1 of 1 existing user of "human-user" has no "email"',
        );
        expect(app.envelopeOf(result).warnings?.join("\n")).toContain(
          "users update <user_id> --schema <revision_id> --set attributes.email=<value> --server",
        );
      });

      it("does not count deactivated users", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsADeactivatedUserWithoutAnEmail();

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result).warnings ?? []).toEqual([]);
      });

      it("does not warn when every user carries the identifier", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithAnEmail();

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result).warnings ?? []).toEqual([]);
      });

      it("warns that SSO users on a schema no flow serves cannot sign in", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsASsoUserOnAnotherSchema();

        const result = await app.deployDryRun(["--force"]);

        expect(app.envelopeOf(result).warnings?.join("\n")).toContain("has an SSO link");
      });

      it("says it could not finish when the provider links cannot be read", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWhoseLinksCannotBeRead();

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result).warnings?.join("\n")).toContain(
          "Could not finish checking existing users",
        );
      });

      it("refuses a deploy that leaves existing users unable to sign in", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();

        const result = await app.deploy();

        expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
      });

      it("deploys nothing when it refuses a lockout", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();
        const before = await app.liveDeploymentCount();

        await app.deploy();

        expect(await app.liveDeploymentCount()).toBe(before);
      });

      it("deploys a release that leaves existing users unable to sign in with --force", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();

        const result = await app.deploy(["--force"]);

        expect(result).toSucceed();
      });

      it("refuses a dry run that would leave existing users unable to sign in", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();

        const result = await app.deployDryRun();

        expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
      });

      it("previews a release that leaves existing users unable to sign in with --force", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();

        const result = await app.deployDryRun(["--force"]);

        expect(result).toSucceed();
      });

      it("still deploys when the users cannot be read", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.cannotQueryUsers();

        const result = await app.deploy();

        expect(result).toSucceed();
        expect(app.envelopeOf(result).warnings?.join("\n")).toContain(
          "Could not finish checking existing users",
        );
      });

      it("requires -m when non-interactive outside a git repository", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const result = await app.run(["deploy", "--non-interactive", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("records the commit subject when non-interactive and -m is omitted", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        await app.commit();

        const result = await app.run(["deploy", "--non-interactive", "--json"]);

        const data = app.envelopeOf<DeployResult>(result).data;
        expect(await app.releaseMessage(data.release_id ?? "")).toBe("wip");
        expect(await app.deploymentMessage(data.deployment_id ?? "")).toBe("wip");
      });

      it("rejects a blank -m rather than falling back", async () => {
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

      it("does not warn that the subject claim can change once the connection is deployed", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.enableSso("google", {
          clientId: "1234-abc.apps.googleusercontent.com",
          secret: "the-client-secret",
        });
        await app.editConnection("google", (connection) => {
          connection.subject_claim = "email";
        });
        await app.deployData();

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result).warnings ?? []).toEqual([]);
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
        const app = await anUndeployedEnvironment();

        // Nothing is deployed to it yet, so there is no deployment to guard
        // against. The deploy must omit expected_deployment_id entirely: an
        // empty or placeholder id would be rejected by the request schema, so a
        // succeeding first deploy proves the field was left off.
        const data = await app.deployData(["--env", "staging"]);

        expect(data.deployment_id).toMatch(/^dep_/);
        const listed = await app.run(["deployment", "list", "--env", "staging", "--json"]);
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

        const before = await app.liveDeploymentCount();

        const dry = await app.deployDryRun();

        expect(dry).toSucceed();
        expect(await app.liveDeploymentCount()).toBe(before);
      });

      it("shows what a dry run would change since the live release", async () => {
        const app = await aCommittedApp();
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
        const app = await aCommittedApp();
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

      it("suggests committing what it deployed, in the directory it deployed", async () => {
        const app = await aCommittedApp();
        await app.editUserSchema((schema) => {
          schema.properties.nickname = { type: "string" };
        });

        const result = await app.deploy();

        expect(result).toSuggest(`git -C '${app.path}' add .zitadel`);
      });

      it("puts the deploy's own message in the commit it suggests", async () => {
        const app = await aCommittedApp();
        await app.editUserSchema((schema) => {
          schema.properties.nickname = { type: "string" };
        });

        const result = await app.deploy(["-m", "add a nickname"]);

        expect(result).toSuggest("commit -m 'add a nickname' -- .zitadel");
      });

      it("suggests no commit when only files outside .zitadel are uncommitted", async () => {
        const app = await aCommittedApp();
        await app.editPackageJson((pkg) => {
          pkg.dependencies.left = "1.0.0";
        });

        const result = await app.deploy();

        expect(result).not.toSuggest("git");
      });

      it("suggests no commit after deploying from a clean tree", async () => {
        const app = await aCommittedApp();

        const result = await app.deploy();

        expect(result).not.toSuggest("git commit");
      });
    });

    describe("rendered for a terminal", () => {
      it("says what it deployed", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");

        const result = await app.deployRendered();

        expect(result).toPrint("Deployed");
      });

      it("names the release and every origin it went to, under the closing line", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");

        const result = await app.deployRendered();

        expect(result).toPrint("is now live on http://localhost:3000 and https://app.acme.com.");
      });

      it("diffs a deploy right after setup against the release setup deployed", async () => {
        const app = await aCommittedApp();

        const result = await app.deployRendered();

        expect(result).toPrint("No changes to .zitadel/ since");
      });

      it("has no baseline to diff against on an environment's first deploy", async () => {
        const app = await anUndeployedEnvironment();

        const result = await app.deployRendered(["--env", "staging"]);

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
