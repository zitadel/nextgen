import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import {
  aCommittedApp,
  anUndeployedEnvironment,
  aSetUpApp,
  MOCK_SERVER_URL,
  PASSWORD_POLICY,
  type ScaffoldedApp,
  SETUP_ORIGIN,
} from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";
import { offTerminal } from "@tests/helpers/terminal";
import { PRIMARY_ORIGIN } from "@tests/helpers/records";

const SERVERS = [
  ["a remote server", "http://mock.zitadel.test"],
  ["a local server", "http://localhost:8112"],
];

const platform = usePlatformMock();

const GOOGLE = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

const NO_BASELINE = {
  against: null,
  files: null,
  note: "No diff available: nothing is deployed yet, or the live release has no commit.",
};

const UNCOMMITTED =
  "The git working tree has uncommitted changes, so this release records its commit as approximate and the next deploy cannot diff against it. Commit before you deploy to keep the diff exact.";

const NO_EMAIL_LOCKOUT = expect.stringContaining(
  '1 of 1 existing user of "human-user" has no "email"',
);

const LOCKOUT_MESSAGE =
  "Cannot deploy a release that leaves existing users unable to sign in without --force in non-interactive mode";

const A_SHA = expect.stringMatching(/^[0-9a-f]{40}$/);

/** A deploy message written over two lines, as `git commit -m` keeps one. */
const TWO_LINE_MESSAGE = "add a nickname\nand a title";

/** A set-up app with Google sign-in enabled, ready for a deploy. */
async function anAppWithGoogle(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  await app.enableSso("google", GOOGLE);
  return app;
}

/** A set-up app with a custom OIDC connection enabled, ready for a deploy. */
async function anAppWithCustomSso(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  await app.enableCustomSso(
    { slug: "acme-sso", displayName: "Acme SSO", issuer: "https://sso.acme.example" },
    { clientId: "acme-client-id", secret: "acme-client-secret" },
  );
  return app;
}

/** Mapping mistakes a deploy must refuse, each applied to a Google connection, with what it is refused for. */
const HARD_ERRORS: ReadonlyArray<[string, (app: ScaffoldedApp) => Promise<void>, string, string]> =
  [
    [
      "a mapping target the schema does not define",
      (app) =>
        app.editConnection("google", (c) => {
          c.claim_mapping = { ...c.claim_mapping, contactEmial: "mail" };
        }),
      "contactEmial",
      "sso/orphaned-mapping-target",
    ],
    [
      "a mapping key that contains a dot",
      (app) =>
        app.editConnection("google", (c) => {
          c.claim_mapping = { ...c.claim_mapping, "profile.email": "mail" };
        }),
      "profile.email",
      "sso/orphaned-mapping-target",
    ],
  ];

/**
 * Mapping mistakes that almost certainly do not do what was meant, which a
 * deploy warns about and carries on past: the admin may know better.
 */
const SOFT_WARNINGS: ReadonlyArray<[string, (app: ScaffoldedApp) => Promise<void>, string]> = [
  [
    "a standard claim the catalog connection's scopes do not return",
    async (app) => {
      await app.editUserSchema((schema) => {
        schema.properties.givenName = { type: "string" };
      });
      await app.editConnection("google", (c) => {
        c.oidc.scopes = ["openid", "email"];
        c.claim_mapping = { ...c.claim_mapping, givenName: "given_name" };
      });
    },
    '.zitadel/idps/google.json: claim_mapping reads "given_name", which a provider only returns for the "profile" scope, and oidc.scopes is "openid", "email". Add "profile" to oidc.scopes, or read another claim.',
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
    '.zitadel/idps/google.json: claim_mapping reads "updated_at", a number claim, into "refreshedAt", which the schema types as string. Read a claim of a matching type, or change the type of "refreshedAt".',
  ],
  [
    "a verification that reads a claim which is not a boolean",
    (app) =>
      app.editConnection("google", (c) => {
        c.verified_claims = { email: "email" };
      }),
    '.zitadel/idps/google.json: verified_claims reads "email" to verify "email", but that is a string claim, not one that says whether a value is verified, so it never verifies. Read the claim the provider sends for that (such as "email_verified").',
  ],
  [
    "a subject that is a claim the user can change",
    (app) =>
      app.editConnection("google", (c) => {
        c.subject_claim = "email";
      }),
    '.zitadel/idps/google.json: subject_claim is "email", a profile claim the user can change, and identity keys on the subject, so a change would sign them in as a stranger. Use a claim that never changes: "sub", or a provider-specific one such as "oid".',
  ],
];

describe("deploy", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: expect.stringMatching(
            /^GET http:\/\/mock\.zitadel\.test\/api\/v1\/projects\/proj-[0-9a-f]+ returned 404/,
          ),
          details: {
            status: 404,
            url: expect.stringMatching(/\/api\/v1\/projects\/proj-[0-9a-f]+$/),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(/\/api\/v1\/projects\/proj-[0-9a-f]+$/),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.deploy();
        await waiting;
        pressCtrlC();

        expect(app.envelopeOf(await result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });

      it("exits 130", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.deploy();
        await waiting;
        pressCtrlC();

        expect(await result).toExitWith(130);
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
        await app.addPrimaryOrigin(PRIMARY_ORIGIN);

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            title: "Deployed 4 resources",
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            resources: 4,
            origins: [SETUP_ORIGIN.pattern, PRIMARY_ORIGIN],
            diff: NO_BASELINE,
            next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list"))],
          },
          warnings: [],
        });
      });

      it("re-deploys the same release when nothing changed", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const first = await app.deployData();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            title: "Deployed 4 resources",
            release_id: first.release_id,
            content_hash: first.content_hash,
            deployment_id: expect.stringMatching(/^dep_/),
            resources: 4,
            origins: [SETUP_ORIGIN.pattern, "https://app.example.com"],
            diff: NO_BASELINE,
            next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list"))],
          },
          warnings: [],
        });
      });

      it("publishes a policy file", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });

        const result = await app.publish();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            title: "Deployed 4 resources",
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            resources: 4,
            origins: [SETUP_ORIGIN.pattern, "https://app.example.com"],
            diff: NO_BASELINE,
            next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list"))],
          },
          warnings: [],
        });
      });

      it("publishes an edit of a policy file as a new revision of the same policy", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        await app.publish();
        const [first] = await app.publishedPolicies();
        await app.writePasswordPolicy({ min_length: 14 });

        await app.deploy();

        const [edited] = await app.publishedPolicies();
        expect(first).toMatchObject({ operation: PASSWORD_POLICY, config: { min_length: 12 } });
        expect(edited).toMatchObject({ id: first?.id, config: { min_length: 14 } });
        expect(edited?.revision_id).not.toBe(first?.revision_id);
      });

      it("stops before sending a policy file with a value outside its bounds", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.writePasswordPolicy({ min_length: 0 });

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message:
            "Configuration validation failed (1 issue):\n  - .zitadel/policies/auth.factor.password.set.json: config.min_length Too small: expected number to be >=1",
          hint: "Fix the files named above and rerun; no changes were made.",
          details: {
            issues: [
              {
                rule: "contract/policy",
                path: ".zitadel/policies/auth.factor.password.set.json",
                message: "config.min_length Too small: expected number to be >=1",
              },
            ],
          },
        });
      });

      it("sends no policy it stopped before", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const before = await app.publishedPolicies();
        await app.writePasswordPolicy({ min_length: 0 });

        await app.deploy();

        expect(await app.publishedPolicies()).toEqual(before);
      });

      it("stops before sending a policy file not named after its operation", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.writePasswordPolicy({ min_length: 12 }, { name: "password" });

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message:
            "Configuration validation failed (1 issue):\n  - .zitadel/policies/password.json: holds the auth.factor.password.set policy, so it must be named auth.factor.password.set.json",
          hint: "Fix the files named above and rerun; no changes were made.",
          details: {
            issues: [
              {
                rule: "contract/policy",
                path: ".zitadel/policies/password.json",
                message:
                  "holds the auth.factor.password.set policy, so it must be named auth.factor.password.set.json",
              },
            ],
          },
        });
      });

      it("is refused by the server for a policy whose settings contradict each other", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.writePasswordPolicy({ min_length: 20, max_length: 10 });

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "release: the bundle has invalid resources",
          hint: "policy auth.factor.password.set: policy: invalid.",
          details: {
            status: 400,
            url: expect.stringMatching(/\/api\/v1\/releases\/build\?project_id=proj-[0-9a-f]+$/),
            body: {
              code: "rel.invalid",
              message: "release: the bundle has invalid resources",
              details: {
                resources: [
                  {
                    kind: "policy",
                    index: 0,
                    handle: "auth.factor.password.set",
                    code: "pol.invalid",
                    message: "policy: invalid",
                    details: {
                      details: {
                        violations: [
                          {
                            config_rule: "min_length_not_above_max_length",
                            settings: ["max_length", "min_length"],
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        });
      });

      it("names the schema the server refused, and why", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.rejectsASchema();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "release: invalid",
          hint: 'schema human-user: schema designation invalid: "x-display" names unknown property "nickname".',
          details: {
            status: 400,
            url: expect.stringMatching(/\/api\/v1\/releases\/build\?project_id=proj-[0-9a-f]+$/),
            body: {
              code: "rel.invalid",
              message: "release: invalid",
              details: {
                resources: [
                  {
                    kind: "schema",
                    handle: "human-user",
                    code: "sch.invalid_request",
                    message:
                      'schema designation invalid: "x-display" names unknown property "nickname"',
                  },
                ],
              },
            },
          },
        });
      });

      it("names the flow the server refused, and why", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.rejectsAFlow();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "release: invalid",
          hint: 'flow default-login: flow definition: invalid: step "register-password": on_success create_user requires "identifier".',
          details: {
            status: 400,
            url: expect.stringMatching(/\/api\/v1\/releases\/build\?project_id=proj-[0-9a-f]+$/),
            body: {
              code: "rel.invalid",
              message: "release: invalid",
              details: {
                resources: [
                  {
                    kind: "flow",
                    handle: "default-login",
                    code: "flowdef.invalid",
                    message: "flow definition: invalid",
                    details: {
                      details:
                        'step "register-password": on_success create_user requires "identifier"',
                    },
                  },
                ],
              },
            },
          },
        });
      });

      it("names the field the server refused to change on a connection", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.rejectsAConnection();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "release: invalid",
          hint: "idp google: identity provider connection: the field is fixed for the life of the connection: oidc.issuer.",
          details: {
            status: 400,
            url: expect.stringMatching(/\/api\/v1\/releases\/build\?project_id=proj-[0-9a-f]+$/),
            body: {
              code: "rel.invalid",
              message: "release: invalid",
              details: {
                resources: [
                  {
                    kind: "idp",
                    handle: "google",
                    code: "idp.field_immutable",
                    message:
                      "identity provider connection: the field is fixed for the life of the connection",
                    details: { details: { fields: ["oidc.issuer"] } },
                  },
                ],
              },
            },
          },
        });
      });

      it("does not warn about the scaffolded login flow", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Validated 4 resources and deployed nothing (dry run)",
            resources: 4,
            targets: "primary",
            diff: NO_BASELINE,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>'")),
            ],
          },
          warnings: [],
        });
      });

      it("warns when the login path reaches a password step with no identifier before it", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.editLoginEntryStep((step) => {
          step.fields = [];
        });

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Validated 4 resources and deployed nothing (dry run)",
            resources: 4,
            targets: "primary",
            diff: NO_BASELINE,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>'")),
            ],
          },
          warnings: [
            '.zitadel/flows/default-login.json: step "password" collects x-auth-methods#password on the login path but no upstream step collects an identifier field — the engine cannot resolve which user to challenge',
          ],
        });
      });

      it("warns that users without the identifier cannot sign in", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();

        const result = await app.deployDryRun(["--force"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Validated 4 resources and deployed nothing (dry run)",
            resources: 4,
            targets: "primary",
            diff: NO_BASELINE,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>' --force")),
            ],
          },
          warnings: [NO_EMAIL_LOCKOUT],
        });
      });

      it("names the command that moves each user to a schema that defines the identifier", async () => {
        const app = await aSetUpApp(["--preset", "passkey-first"]);
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();

        const result = await app.deployDryRun(["--force"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Validated 4 resources and deployed nothing (dry run)",
            resources: 4,
            targets: "primary",
            diff: NO_BASELINE,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>' --force")),
            ],
          },
          warnings: [
            expect.stringContaining(
              `user update '<user_id>' --schema '<revision_id>' --set 'attributes.email=<value>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
            ),
          ],
        });
      });

      it("does not count deactivated users", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsADeactivatedUserWithoutAnEmail();

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Validated 4 resources and deployed nothing (dry run)",
            resources: 4,
            targets: "primary",
            diff: NO_BASELINE,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>'")),
            ],
          },
          warnings: [],
        });
      });

      it("does not warn when every user carries the identifier", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithAnEmail();

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Validated 4 resources and deployed nothing (dry run)",
            resources: 4,
            targets: "primary",
            diff: NO_BASELINE,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>'")),
            ],
          },
          warnings: [],
        });
      });

      it("warns that SSO users on a schema no flow serves cannot sign in", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsASsoUserOnAnotherSchema();

        const result = await app.deployDryRun(["--force"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Validated 4 resources and deployed nothing (dry run)",
            resources: 4,
            targets: "primary",
            diff: NO_BASELINE,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>' --force")),
            ],
          },
          warnings: [expect.stringContaining("(1 of them has an SSO link)")],
        });
      });

      it("says it could not finish when the provider links cannot be read", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWhoseLinksCannotBeRead();

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_CONFIRMATION_REQUIRED",
          message: LOCKOUT_MESSAGE,
          hint: `Ask a person first: Deploy to ${await app.projectPlace()} even though the users above will not be able to sign in? Pass --force only once they agree.`,
          next_commands: [expectedPublicCliCommand(app.againAsRun("deploy --dry-run --force"))],
          details: {
            question: `Deploy to ${await app.projectPlace()} even though the users above will not be able to sign in?`,
          },
          warnings: [
            "Could not finish checking existing users for sign-in lockouts: a request to the server failed.",
            expect.stringContaining("is on a schema no flow in this release uses"),
          ],
        });
      });

      it("refuses a deploy that leaves existing users unable to sign in", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();
        const place = await app.projectPlace();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_CONFIRMATION_REQUIRED",
          message: LOCKOUT_MESSAGE,
          hint: `Ask a person first: Deploy to ${place} even though the users above will not be able to sign in? Pass --force only once they agree.`,
          next_commands: [
            expectedPublicCliCommand(app.againAsRun("deploy --force --message 'test deploy'")),
          ],
          details: {
            question: `Deploy to ${place} even though the users above will not be able to sign in?`,
          },
          warnings: [NO_EMAIL_LOCKOUT],
        });
      });

      it.each(SERVERS)(
        "names the project and the server in the lockout question, for %s",
        async (_kind, server) => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin();
          platform.holdsAUserWithoutAnEmail();
          const place = await app.projectPlace(server);

          const result = await app.runWithoutServer([
            "deploy",
            "-m",
            "a lockout",
            "--server",
            server,
            "--non-interactive",
            "--json",
          ]);

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "deploy",
            source: server,
            code: "E_CONFIRMATION_REQUIRED",
            message: LOCKOUT_MESSAGE,
            hint: `Ask a person first: Deploy to ${place} even though the users above will not be able to sign in? Pass --force only once they agree.`,
            next_commands: [
              expectedPublicCliCommand(
                `deploy --force --message 'a lockout' --server ${server} --cwd ${app.path}`,
              ),
            ],
            details: {
              question: `Deploy to ${place} even though the users above will not be able to sign in?`,
            },
            warnings: [NO_EMAIL_LOCKOUT],
          });
        },
      );

      it("keeps a message holding an escape sequence spelled out in the command it suggests", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();

        const result = await app.run([
          "deploy",
          "-m",
          "a\u001b[2Jb",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_CONFIRMATION_REQUIRED",
          message: LOCKOUT_MESSAGE,
          hint: `Ask a person first: Deploy to ${await app.projectPlace()} even though the users above will not be able to sign in? Pass --force only once they agree.`,
          next_commands: [
            expectedPublicCliCommand(app.againAsRun("deploy --force --message $'a\\x1b[2Jb'")),
          ],
          details: {
            question: `Deploy to ${await app.projectPlace()} even though the users above will not be able to sign in?`,
          },
          warnings: [NO_EMAIL_LOCKOUT],
        });
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

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            title: "Deployed 4 resources",
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            resources: 4,
            origins: [SETUP_ORIGIN.pattern, "https://app.example.com"],
            diff: NO_BASELINE,
            next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list"))],
          },
          warnings: [NO_EMAIL_LOCKOUT],
        });
      });

      it("refuses a dry run that would leave existing users unable to sign in", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();
        const place = await app.projectPlace();

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_CONFIRMATION_REQUIRED",
          message: LOCKOUT_MESSAGE,
          hint: `Ask a person first: Deploy to ${place} even though the users above will not be able to sign in? Pass --force only once they agree.`,
          next_commands: [expectedPublicCliCommand(app.againAsRun("deploy --dry-run --force"))],
          details: {
            question: `Deploy to ${place} even though the users above will not be able to sign in?`,
          },
          warnings: [NO_EMAIL_LOCKOUT],
        });
      });

      it("keeps the message a dry run was typed with on the dry run it suggests after a lockout", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();

        const result = await app.deployDryRun(["-m", "a nickname"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_CONFIRMATION_REQUIRED",
          message: LOCKOUT_MESSAGE,
          hint: `Ask a person first: Deploy to ${await app.projectPlace()} even though the users above will not be able to sign in? Pass --force only once they agree.`,
          next_commands: [
            expectedPublicCliCommand(
              app.againAsRun("deploy --dry-run --force --message 'a nickname'"),
            ),
          ],
          details: {
            question: `Deploy to ${await app.projectPlace()} even though the users above will not be able to sign in?`,
          },
          warnings: [NO_EMAIL_LOCKOUT],
        });
      });

      it("previews a release that leaves existing users unable to sign in with --force", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();

        const result = await app.deployDryRun(["--force"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Validated 4 resources and deployed nothing (dry run)",
            resources: 4,
            targets: "primary",
            diff: NO_BASELINE,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>' --force")),
            ],
          },
          warnings: [NO_EMAIL_LOCKOUT],
        });
      });

      it("still deploys when the users cannot be read", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.cannotQueryUsers();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            title: "Deployed 4 resources",
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            resources: 4,
            origins: [SETUP_ORIGIN.pattern, "https://app.example.com"],
            diff: NO_BASELINE,
            next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list"))],
          },
          warnings: [
            "Could not finish checking existing users for sign-in lockouts: a request to the server failed.",
          ],
        });
      });

      it("requires -m when non-interactive outside a git repository", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const result = await app.run(["deploy", "--non-interactive", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "A deploy needs a message in non-interactive mode",
          hint: "Pass -m/--message with a short summary of what this release changes, or deploy from a clean git commit.",
        });
      });

      it("deploys with the commit subject when non-interactive and -m is omitted", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        await app.commit();

        const result = await app.run(["deploy", "--non-interactive", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            title: "Deployed 4 resources",
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            resources: 4,
            origins: [SETUP_ORIGIN.pattern, "https://app.example.com"],
            diff: NO_BASELINE,
            next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list"))],
          },
          warnings: [],
        });
      });

      it("records the commit subject as the release and deployment message", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        await app.commit();

        const result = await app.run(["deploy", "--non-interactive", "--json"]);

        const data = app.envelopeOf<{ release_id: string; deployment_id: string }>(result).data;
        expect(await app.releaseMessage(data.release_id)).toBe("wip");
        expect(await app.deploymentMessage(data.deployment_id)).toBe("wip");
      });

      it("rejects a blank -m rather than falling back", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const result = await app.run(["deploy", "--non-interactive", "--json", "-m", "   "]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "the value is empty",
          hint: "Pass a shorter summary with -m.",
          details: { argument: "--message" },
        });
      });

      it("fails when the project has no primary origin", async () => {
        const app = await aSetUpApp();
        await app.removeOrigin(SETUP_ORIGIN.pattern);

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "The project has no primary origin to deploy to",
          hint: "Add the URL the app serves from as a primary origin, then deploy.",
          next_commands: [
            expectedPublicCliCommand(
              app.againAsRun(`origin add ${SETUP_ORIGIN.pattern} --kind primary`),
            ),
          ],
        });
      });

      it("points a project whose issuer setup 0.1.0 registered as a preview origin at doctor --fix", async () => {
        const app = await aSetUpApp();
        await app.hasItsIssuerAsAPreviewOrigin();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "The project has no primary origin to deploy to",
          hint: `It holds its issuer ${SETUP_ORIGIN.pattern} as a preview origin, as setup 0.1.0 registered it, so adding it as primary conflicts. Make it primary, then deploy.`,
          next_commands: [expectedPublicCliCommand(app.againAsRun("doctor --fix"))],
        });
      });

      it("checks for a primary origin before syncing IdP connections", async () => {
        const app = await aSetUpApp();
        await app.removeOrigin(SETUP_ORIGIN.pattern);
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

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "The project has no primary origin to deploy to",
          hint: "Add the URL the app serves from as a primary origin, then deploy.",
          next_commands: [
            expectedPublicCliCommand(
              app.againAsRun(`origin add ${SETUP_ORIGIN.pattern} --kind primary`),
            ),
          ],
        });
      });

      it("registers no connection before it knows where to deploy", async () => {
        const app = await aSetUpApp();
        await app.removeOrigin(SETUP_ORIGIN.pattern);
        await app.enableSso("google", GOOGLE);

        await app.deploy();

        expect(await app.registeredIdps()).toEqual([]);
      });

      it("registers a sign-in provider through the release", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.enableSso("google", GOOGLE);

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            title: "Deployed 5 resources",
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            resources: 5,
            origins: [SETUP_ORIGIN.pattern, "https://app.example.com"],
            diff: NO_BASELINE,
            next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list"))],
          },
          warnings: [],
        });
        expect((await app.registeredIdps()).map((idp) => idp.slug)).toEqual(["google"]);
      });

      it("does not warn that the subject claim can change once the connection is deployed", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.enableSso("google", GOOGLE);
        await app.editConnection("google", (connection) => {
          connection.subject_claim = "email";
        });
        await app.deployData();

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Validated 5 resources and deployed nothing (dry run)",
            resources: 5,
            targets: "primary",
            diff: NO_BASELINE,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>'")),
            ],
          },
          warnings: [],
        });
      });

      it("writes no connection when the deploy never reaches the release", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", GOOGLE);
        await app.removeVariable("GOOGLE_CLIENT_SECRET");
        await app.removeOrigin(SETUP_ORIGIN.pattern);

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "The project has no primary origin to deploy to",
          hint: "Add the URL the app serves from as a primary origin, then deploy.",
          next_commands: [
            expectedPublicCliCommand(
              app.againAsRun(`origin add ${SETUP_ORIGIN.pattern} --kind primary`),
            ),
          ],
        });
        expect(await app.registeredIdps()).toEqual([]);
      });

      it("refuses a connection whose secret variable the project does not hold", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.enableSso("google", GOOGLE);
        await app.removeVariable("GOOGLE_CLIENT_SECRET");

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_CREDENTIAL_MISSING",
          message:
            ".zitadel/idps/google.json: client_secret names the variable GOOGLE_CLIENT_SECRET, which the project does not have",
          hint: "Publish it with the command below, then deploy again.",
          next_commands: [
            expectedPublicCliCommand(app.againAsRun("variable set GOOGLE_CLIENT_SECRET --secret")),
          ],
          details: {
            variable: "GOOGLE_CLIENT_SECRET",
            field: "client_secret",
            file: ".zitadel/idps/google.json",
          },
        });
      });

      it("prints no secret a connection holds", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.enableSso("google", GOOGLE);

        const result = await app.deploy();

        expect(result.stdout + result.stderr).not.toContain(GOOGLE.secret);
      });

      it("takes no --origin, as primary origins are never named one by one", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.example.com");

        const result = await app.deploy(["--origin", "https://app.example.com"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "Nonexistent flag: --origin",
          next_commands: [expectedPublicCliCommand("deploy --help")],
          details: {
            original: {
              name: "Error",
              message: "Nonexistent flag: --origin\nSee more help with --help",
            },
          },
        });
      });

      it("omits the guard on a first deploy, when nothing is live", async () => {
        const app = await anUndeployedEnvironment();

        const result = await app.deploy(["--env", "staging"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            title: "Deployed 4 resources",
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            resources: 4,
            origins: ["https://staging.acme.com"],
            diff: NO_BASELINE,
            next_commands: [
              expectedPublicCliCommand(
                `deployment list --env staging --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("serves that first deploy", async () => {
        const app = await anUndeployedEnvironment();

        await app.deploy(["--env", "staging"]);

        const listed = await app.run(["deployment", "list", "--env", "staging", "--json"]);
        expect(app.envelopeOf<{ count: number }>(listed).data.count).toBe(1);
      });

      it("passes the observed deployment and re-deploys unchanged content", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const first = await app.deployData();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            title: "Deployed 4 resources",
            release_id: first.release_id,
            content_hash: first.content_hash,
            deployment_id: expect.stringMatching(/^dep_/),
            resources: 4,
            origins: [SETUP_ORIGIN.pattern, "https://app.example.com"],
            diff: NO_BASELINE,
            next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list"))],
          },
          warnings: [],
        });
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

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_CONFLICT",
          message: `This content was already released as ${first.release_id}, which is revoked`,
          hint: "A revoked release can never be served again. Change the configuration so it builds a new release.",
          details: {
            release_id: first.release_id,
            content_hash: first.content_hash,
          },
        });
      });

      it("fails with a conflict when another deploy lands first", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        platform.racesTheNextDeploy();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_CONFLICT",
          message: "Another deploy changed the targets since this one was prepared",
          hint: `Rerun ${expectedPublicCliCommand(app.againAsRun("deploy --message 'test deploy'"))}; it will build and deploy against the current state.`,
          next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list --live"))],
          details: {
            current_deployment: {
              id: expect.stringMatching(/^dep_/),
              project_id: expect.stringMatching(/^proj-/),
              release_id: expect.stringMatching(/^rel_/),
              targets: [{ origin: SETUP_ORIGIN.pattern }, { origin: "https://app.example.com" }],
              kind: "primary",
              status: "live",
              deployed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
              metadata: {
                reason: "deploy",
                message: "test deploy",
                rollback_to: null,
                deployed_by: null,
                deployed_by_type: "service",
              },
            },
          },
        });
      });

      it("keeps the flags it was typed with on the command it hints at when another deploy lands first", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        platform.racesTheNextDeploy();

        const result = await app.deploy(["-m", "add a nickname", "--force"]);

        expect(result).toHintAt(
          expectedPublicCliCommand(app.againAsRun("deploy --message 'add a nickname' --force")),
        );
      });

      describe("under --dry-run", () => {
        it("validates the bundle and deploys nothing", async () => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin();

          const result = await app.deployDryRun();

          expect(app.envelopeOf(result)).toEqual({
            status: "ok",
            cli_version: cliVersion.version,
            command: "deploy",
            source: MOCK_SERVER_URL,
            data: {
              dry_run: true,
              title: "Validated 4 resources and deployed nothing (dry run)",
              resources: 4,
              targets: "primary",
              diff: NO_BASELINE,
              next_commands: [
                expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>'")),
              ],
            },
            warnings: [],
          });
        });

        it("writes nothing", async () => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin();
          const before = await app.liveDeploymentCount();

          await app.deployDryRun();

          expect(await app.liveDeploymentCount()).toBe(before);
        });

        it("keeps the message and --force it was typed with on the real command it suggests", async () => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin();

          const result = await app.deployDryRun(["-m", "add a nickname", "--force"]);

          expect(app.envelopeOf(result)).toEqual({
            status: "ok",
            cli_version: cliVersion.version,
            command: "deploy",
            source: MOCK_SERVER_URL,
            data: {
              dry_run: true,
              title: "Validated 4 resources and deployed nothing (dry run)",
              resources: 4,
              targets: "primary",
              diff: NO_BASELINE,
              next_commands: [
                expectedPublicCliCommand(
                  app.againAsRun("deploy --message 'add a nickname' --force"),
                ),
              ],
            },
            warnings: [],
          });
        });

        it("keeps the environment it was typed with on the real command it suggests", async () => {
          const app = await anUndeployedEnvironment();

          const result = await app.deployDryRun(["--env", "staging"]);

          expect(app.envelopeOf(result)).toEqual({
            status: "ok",
            cli_version: cliVersion.version,
            command: "deploy",
            source: MOCK_SERVER_URL,
            data: {
              dry_run: true,
              title: "Validated 4 resources and deployed nothing (dry run)",
              resources: 4,
              targets: "primary",
              diff: NO_BASELINE,
              next_commands: [
                expectedPublicCliCommand(
                  `deploy --message '<what changed>' --env staging --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [],
          });
        });

        it("shows what it would change since the live release", async () => {
          const app = await aCommittedApp();
          await app.editUserSchema((schema) => {
            schema.properties.nickname = { type: "string" };
          });

          const result = await app.deployDryRun();

          expect(app.envelopeOf(result)).toEqual({
            status: "ok",
            cli_version: cliVersion.version,
            command: "deploy",
            source: MOCK_SERVER_URL,
            data: {
              dry_run: true,
              title: "Validated 4 resources and deployed nothing (dry run)",
              resources: 4,
              targets: "primary",
              diff: {
                against: A_SHA,
                files: [
                  {
                    path: ".zitadel/schemas/default-human-user.json",
                    status: "modified",
                    patch: expect.stringContaining('+    "nickname": {'),
                  },
                ],
              },
              next_commands: [
                expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>'")),
              ],
            },
            warnings: [],
          });
        });
      });

      it("reports what a deploy changed since the release it replaced", async () => {
        const app = await aCommittedApp();
        await app.editUserSchema((schema) => {
          schema.properties.nickname = { type: "string" };
        });

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            title: "Deployed 4 resources",
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            resources: 4,
            origins: [SETUP_ORIGIN.pattern],
            diff: {
              against: A_SHA,
              files: [
                {
                  path: ".zitadel/schemas/default-human-user.json",
                  status: "modified",
                  patch: expect.stringContaining('+    "nickname": {'),
                },
              ],
            },
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deployment list")),
              `git -C ${app.path} add .zitadel && git -C ${app.path} commit -m 'test deploy' -- .zitadel`,
            ],
          },
          warnings: [UNCOMMITTED],
        });
      });

      it("puts the deploy's own message in the commit it suggests", async () => {
        const app = await aCommittedApp();
        await app.editUserSchema((schema) => {
          schema.properties.nickname = { type: "string" };
        });

        const result = await app.deploy(["-m", "add a nickname"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            title: "Deployed 4 resources",
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            resources: 4,
            origins: [SETUP_ORIGIN.pattern],
            diff: {
              against: A_SHA,
              files: [
                {
                  path: ".zitadel/schemas/default-human-user.json",
                  status: "modified",
                  patch: expect.stringContaining('+    "nickname": {'),
                },
              ],
            },
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deployment list")),
              `git -C ${app.path} add .zitadel && git -C ${app.path} commit -m 'add a nickname' -- .zitadel`,
            ],
          },
          warnings: [UNCOMMITTED],
        });
      });

      it("writes a message that spans lines as one word in the commit it suggests", async () => {
        const app = await aCommittedApp();
        await app.editUserSchema((schema) => {
          schema.properties.nickname = { type: "string" };
        });

        const result = await app.deploy(["-m", TWO_LINE_MESSAGE]);

        expect(app.envelopeOf(result)).toMatchObject({
          data: {
            next_commands: expect.arrayContaining([
              `git -C ${app.path} add .zitadel && git -C ${app.path} commit -m $'add a nickname\\nand a title' -- .zitadel`,
            ]),
          },
        });
      });

      it("suggests no commit when only files outside .zitadel are uncommitted", async () => {
        const app = await aCommittedApp();
        await app.editPackageJson((pkg) => {
          pkg.dependencies.left = "1.0.0";
        });

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            title: "Deployed 4 resources",
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            resources: 4,
            origins: [SETUP_ORIGIN.pattern],
            diff: {
              against: A_SHA,
              files: [],
            },
            next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list"))],
          },
          warnings: [UNCOMMITTED],
        });
      });

      it("suggests no commit after deploying from a clean tree", async () => {
        const app = await aCommittedApp();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            title: "Deployed 4 resources",
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            resources: 4,
            origins: [SETUP_ORIGIN.pattern],
            diff: {
              against: A_SHA,
              files: [],
            },
            next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list"))],
          },
          warnings: [],
        });
      });

      it("keeps a hostile origin and content hash raw", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const origin = platform.servesAHostileOrigin();
        const hash = platform.buildsAReleaseWithAHostileHash();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            title: "Deployed 4 resources",
            release_id: "rel_1",
            content_hash: hash,
            deployment_id: "dep_hostile",
            resources: 4,
            origins: [origin],
            diff: NO_BASELINE,
            next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list"))],
          },
          warnings: [],
        });
      });

      describe("refuses a mapping that cannot work", () => {
        it.each(HARD_ERRORS)("deploy stops on %s", async (_name, edit, target, rule) => {
          const app = await anAppWithGoogle();
          await edit(app);

          const result = await app.deploy();

          const issue = `claim_mapping target "${target}" is not a property of any schema that lists "google" in sso.providers. Fix the name, or remove the row.`;
          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "deploy",
            source: MOCK_SERVER_URL,
            code: "E_VALIDATION",
            message: `Configuration validation failed (1 issue):\n  - .zitadel/idps/google.json: ${issue}`,
            hint: "Fix the files named above and rerun; no changes were made.",
            details: {
              issues: [{ rule, path: ".zitadel/idps/google.json", message: issue }],
            },
          });
        });

        it.each(HARD_ERRORS)("deploy --dry-run stops on %s", async (_name, edit, target, rule) => {
          const app = await anAppWithGoogle();
          await edit(app);

          const result = await app.deployDryRun();

          const issue = `claim_mapping target "${target}" is not a property of any schema that lists "google" in sso.providers. Fix the name, or remove the row.`;
          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "deploy",
            source: MOCK_SERVER_URL,
            code: "E_VALIDATION",
            message: `Configuration validation failed (1 issue):\n  - .zitadel/idps/google.json: ${issue}`,
            hint: "Fix the files named above and rerun; no changes were made.",
            details: {
              issues: [{ rule, path: ".zitadel/idps/google.json", message: issue }],
            },
          });
        });
      });

      describe("warns about a mapping that probably does not do what was meant", () => {
        it.each(SOFT_WARNINGS)(
          "deploy --dry-run carries on past %s, saying so once",
          async (_name, edit, warning) => {
            const app = await anAppWithGoogle();
            await edit(app);

            const result = await app.deployDryRun();

            expect(app.envelopeOf(result)).toEqual({
              status: "ok",
              cli_version: cliVersion.version,
              command: "deploy",
              source: MOCK_SERVER_URL,
              data: {
                dry_run: true,
                title: "Validated 5 resources and deployed nothing (dry run)",
                resources: 5,
                targets: "primary",
                diff: NO_BASELINE,
                next_commands: [
                  expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>'")),
                ],
              },
              warnings: [warning],
            });
          },
        );

        it("says nothing about a changeable subject once the connection is deployed", async () => {
          const app = await anAppWithGoogle();
          await app.editConnection("google", (c) => {
            c.subject_claim = "email";
          });
          await app.deployData();

          const result = await app.deployDryRun();

          expect(app.envelopeOf(result)).toEqual({
            status: "ok",
            cli_version: cliVersion.version,
            command: "deploy",
            source: MOCK_SERVER_URL,
            data: {
              dry_run: true,
              title: "Validated 5 resources and deployed nothing (dry run)",
              resources: 5,
              targets: "primary",
              diff: NO_BASELINE,
              next_commands: [
                expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>'")),
              ],
            },
            warnings: [],
          });
        });
      });

      it("lets a sign-up that creates a user without a required property the connection does not map through", async () => {
        const app = await anAppWithGoogle();
        await app.editUserSchema((schema) => {
          schema.properties.staffNumber = { type: "string" };
          schema.required = [...(schema.required ?? []), "staffNumber"];
        });
        await app.editLoginEntryStep((step) => {
          step.fields = [...(step.fields ?? []), "staffNumber"];
        });

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Validated 5 resources and deployed nothing (dry run)",
            resources: 5,
            targets: "primary",
            diff: NO_BASELINE,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>'")),
            ],
          },
          warnings: [],
        });
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

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Validated 5 resources and deployed nothing (dry run)",
            resources: 5,
            targets: "primary",
            diff: NO_BASELINE,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>'")),
            ],
          },
          warnings: [],
        });
      });

      it("warns that a custom connection reads a claim its scopes do not return", async () => {
        const app = await anAppWithCustomSso();
        await app.editConnection("acme-sso", (c) => {
          c.oidc.scopes = ["openid"];
        });

        const result = await app.deployDryRun();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          data: {
            dry_run: true,
            title: "Validated 5 resources and deployed nothing (dry run)",
            resources: 5,
            targets: "primary",
            diff: NO_BASELINE,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>'")),
            ],
          },
          warnings: [
            '.zitadel/idps/acme-sso.json: claim_mapping reads "email", which a provider only returns for the "email" scope, and oidc.scopes is "openid". Add "email" to oidc.scopes, or read another claim.',
            '.zitadel/idps/acme-sso.json: verified_claims reads "email_verified", which a provider only returns for the "email" scope, and oidc.scopes is "openid". Add "email" to oidc.scopes, or read another claim.',
          ],
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says what it deployed", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin(PRIMARY_ORIGIN);

        const result = await app.deployRendered();

        expect(result).toPrint("Deployed 4 resources");
      });

      it("names the release and every origin it went to, under the closing line", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin(PRIMARY_ORIGIN);

        const result = await app.deployRendered();

        expect(result).toPrint(`is now live on http://localhost:3000 and ${PRIMARY_ORIGIN}.`);
      });

      it("sets the release line apart from the title when piped, as the terminal does", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin(PRIMARY_ORIGIN);

        const result = await offTerminal(() => app.deployRendered());

        expect(result).toPrintExactly("resources\n\nRelease ");
      });

      it("suggests listing the deployments once", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const result = await app.deployRendered();

        expect(result).toSayOnce(expectedPublicCliCommand(app.againAsRun("deployment list")));
      });

      it("spells out an escape sequence in an origin and a content hash", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.servesAHostileOrigin();
        platform.buildsAReleaseWithAHostileHash();

        const result = await app.deployRendered();

        expect(result).toPrint(
          `Release sha256\\x1b[2Jwiped:aaaaaaaaaaaa is now live on ${PRIMARY_ORIGIN}\\x1b[2Jwiped.`,
        );
      });

      it("spells out an escape sequence in the message of the command it suggests", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();

        const result = await app.run(["deploy", "-m", "a\u001b[2Jb", "--non-interactive"]);

        expect(result).toSayOnce("--message $'a\\x1b[2Jb'");
      });

      it("warns once about the users it would lock out", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        platform.holdsAUserWithoutAnEmail();

        const result = await app.deployRendered();

        expect(result).toSayOnce('has no "email"');
      });

      it("says what a dry run validated", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const result = await app.run(["deploy", "--dry-run", "--non-interactive"]);

        expect(result).toPrint("Validated 4 resources and deployed nothing (dry run)");
      });

      it("suggests the real deploy after a dry run once", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const result = await app.run(["deploy", "--dry-run", "--non-interactive"]);

        expect(result).toSayOnce(
          expectedPublicCliCommand(app.againAsRun("deploy --message '<what changed>'")),
        );
      });

      it("prints no secret a connection holds", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.enableSso("google", GOOGLE);

        const result = await app.deployRendered();

        expect(result.stdout + result.stderr).not.toContain(GOOGLE.secret);
      });

      it("names the repair for a missing primary origin once", async () => {
        const app = await aSetUpApp();
        await app.hasItsIssuerAsAPreviewOrigin();

        const result = await app.deployRendered();

        expect(result).toSayOnce("doctor --fix");
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
