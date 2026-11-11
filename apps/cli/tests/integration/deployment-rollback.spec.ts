import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anUndeployedEnvironment, aSetUpApp, MOCK_SERVER_URL } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";
import { asTerminal, RENDERINGS } from "@tests/helpers/terminal";

const SERVERS = [
  ["a remote server", "http://mock.zitadel.test"],
  ["a local server", "http://localhost:8112"],
];

const platform = usePlatformMock();

const DEPLOYMENT_ID = /^dep_[a-zA-Z0-9_-]+$/;
const DEPLOYMENTS_URL = /^http:\/\/mock\.zitadel\.test\/api\/v1\/deployments\?project_id=proj-/;
const A_RELEASE = "rel_01M6KPFXAE68N6G2X1HN5XD29R";
const A_DEPLOYMENT = "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6";
const INVALID_DEPLOYMENT_ID =
  "Invalid deployment_id: must be a deployment ID: dep_ followed by letters, digits, _ or -";

describe("deployment rollback", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run([
          "deployment",
          "rollback",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: expect.stringMatching(/^GET http:\/\/mock\.zitadel\.test\/api\/v1\/deployments/),
          details: {
            status: 404,
            url: expect.stringMatching(DEPLOYMENTS_URL),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run([
          "deployment",
          "rollback",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: MOCK_SERVER_URL,
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(DEPLOYMENTS_URL),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      await app.addPrimaryOrigin();
      await app.setVariable("HOST", "app.acme.com");
      await app.deployData();
      platform.servesAHostileOrigin();
      const args = ["deployment", "rollback", "--force"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("undoes the last deploy, re-serving the earlier release", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const first = await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        const second = await app.deployData();
        expect(second.release_id).not.toBe(first.release_id);

        const result = await app.run([
          "deployment",
          "rollback",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: `Rolled back to ${first.release_id}`,
            deployment_id: expect.stringMatching(DEPLOYMENT_ID),
            release_id: first.release_id,
            rolled_back_to: first.deployment_id,
            origins: ["http://localhost:3000", "https://app.example.com"],
            dropped_origins: [],
            restored_origins: [],
            unserved_origins: [],
            pointers: [
              {
                kind: "policy",
                handle: "auth.factor.password.set",
                revision_id: expect.stringMatching(/^polrev_/),
              },
              {
                kind: "policy",
                handle: "user.create",
                revision_id: expect.stringMatching(/^polrev_/),
              },
              {
                kind: "schema",
                handle: "human-user",
                revision_id: expect.stringMatching(/^sch_/),
              },
              {
                kind: "flow_definition",
                handle: "default-login",
                revision_id: expect.stringMatching(/^flowdef_/),
              },
            ],
          },
          warnings: [],
        });
      });

      it("records -m on the rollback", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        await app.deployData();

        const result = await app.run([
          "deployment",
          "rollback",
          "--force",
          "-m",
          "company broke sign-up",
          "--non-interactive",
          "--json",
        ]);

        const { deployment_id } = app.envelopeOf<{ deployment_id: string }>(result).data;
        expect(await app.deploymentMessage(deployment_id)).toBe("company broke sign-up");
      });

      it("guards a bare rollback with the deployment it undoes", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.one = { type: "string" };
        });
        const undone = await app.deployData();
        const rollbacks = platform.capturesRollbacks();

        await app.run(["deployment", "rollback", "--force", "--non-interactive", "--json"]);

        expect(rollbacks.last?.expected_deployment_id).toBe(undone.deployment_id);
      });

      it("re-applies a deployment to an origin since removed", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        await app.addPrimaryOrigin("https://b.example.com");
        const first = await app.deployData();
        await app.removeOrigin("https://b.example.com");

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: `Rolled back to ${first.release_id}`,
            deployment_id: expect.stringMatching(DEPLOYMENT_ID),
            release_id: first.release_id,
            rolled_back_to: null,
            origins: ["http://localhost:3000", "https://a.example.com", "https://b.example.com"],
            dropped_origins: [],
            restored_origins: [],
            unserved_origins: ["https://b.example.com"],
            pointers: [
              {
                kind: "policy",
                handle: "auth.factor.password.set",
                revision_id: expect.stringMatching(/^polrev_/),
              },
              {
                kind: "policy",
                handle: "user.create",
                revision_id: expect.stringMatching(/^polrev_/),
              },
              {
                kind: "schema",
                handle: "human-user",
                revision_id: expect.stringMatching(/^sch_/),
              },
              {
                kind: "flow_definition",
                handle: "default-login",
                revision_id: expect.stringMatching(/^flowdef_/),
              },
            ],
          },
          warnings: [],
        });
      });

      it("reports a listed origin the restored deployment leaves out", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        const first = await app.deployData();
        await app.addPrimaryOrigin("https://c.example.com");

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: `Rolled back to ${first.release_id}`,
            deployment_id: expect.stringMatching(DEPLOYMENT_ID),
            release_id: first.release_id,
            rolled_back_to: null,
            origins: ["http://localhost:3000", "https://a.example.com"],
            dropped_origins: ["https://c.example.com"],
            restored_origins: [],
            unserved_origins: [],
            pointers: [
              {
                kind: "policy",
                handle: "auth.factor.password.set",
                revision_id: expect.stringMatching(/^polrev_/),
              },
              {
                kind: "policy",
                handle: "user.create",
                revision_id: expect.stringMatching(/^polrev_/),
              },
              {
                kind: "schema",
                handle: "human-user",
                revision_id: expect.stringMatching(/^sch_/),
              },
              {
                kind: "flow_definition",
                handle: "default-login",
                revision_id: expect.stringMatching(/^flowdef_/),
              },
            ],
          },
          warnings: [
            "Rolled back to origins that leave out https://c.example.com: they refuse sign-in until the next deploy.",
          ],
        });
      });

      it("reports a listed origin the restored deployment serves again", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        await app.addPrimaryOrigin("https://b.example.com");
        const first = await app.deployData();
        await app.removeOrigin("https://b.example.com");
        await app.deployData();
        await app.addPrimaryOrigin("https://b.example.com");

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: `Rolled back to ${first.release_id}`,
            deployment_id: expect.stringMatching(DEPLOYMENT_ID),
            release_id: first.release_id,
            rolled_back_to: first.deployment_id,
            origins: ["http://localhost:3000", "https://a.example.com", "https://b.example.com"],
            dropped_origins: [],
            restored_origins: ["https://b.example.com"],
            unserved_origins: [],
            pointers: [
              {
                kind: "policy",
                handle: "auth.factor.password.set",
                revision_id: expect.stringMatching(/^polrev_/),
              },
              {
                kind: "policy",
                handle: "user.create",
                revision_id: expect.stringMatching(/^polrev_/),
              },
              {
                kind: "schema",
                handle: "human-user",
                revision_id: expect.stringMatching(/^sch_/),
              },
              {
                kind: "flow_definition",
                handle: "default-login",
                revision_id: expect.stringMatching(/^flowdef_/),
              },
            ],
          },
          warnings: [
            `Rolled back to origins that include https://b.example.com: they serve ${first.release_id} again.`,
          ],
        });
      });

      it("undoes the last deploy, not a preview deployed after it", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.addOrigin("https://*-acme.vercel.app", "preview");
        const first = await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.one = { type: "string" };
        });
        await app.deployData();
        await app.previewData("https://x-acme.vercel.app");

        const result = await app.run([
          "deployment",
          "rollback",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf<{ release_id: string }>(result).data.release_id).toBe(
          first.release_id,
        );
      });

      it("takes no --origin, as every primary deployment is one history", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.example.com");

        const result = await app.run([
          "deployment",
          "rollback",
          "--origin",
          "https://app.example.com",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: "",
          code: "E_VALIDATION",
          message: INVALID_DEPLOYMENT_ID,
          hint: `Find one with ${expectedPublicCliCommand("deployment list")}, or omit it to undo the last deploy.`,
          next_commands: [expectedPublicCliCommand("deployment list")],
          details: { argument: "deployment_id" },
        });
      });

      it("plans the rollback on a dry run, needing no --force", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const first = await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        await app.deployData();

        const result = await app.run([
          "deployment",
          "rollback",
          "--dry-run",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            dry_run: true,
            title: `Would roll back to ${first.deployment_id} (dry run)`,
            deployment_id: first.deployment_id,
            dropped_origins: [],
            restored_origins: [],
            unserved_origins: [],
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(`deployment rollback ${first.deployment_id ?? ""} --force`),
              ),
            ],
          },
          warnings: [],
        });
      });

      it("rolls back nothing on a dry run", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        await app.deployData();
        const before = await app.liveDeploymentCount();

        await app.run(["deployment", "rollback", "--dry-run", "--non-interactive", "--json"]);

        expect(await app.liveDeploymentCount()).toBe(before);
      });

      it("keeps the typed message when suggesting the real rollback after a dry run", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const first = await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        await app.deployData();

        const result = await app.run([
          "deployment",
          "rollback",
          "--dry-run",
          "-m",
          "restore",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSuggestExactly(
          app.againAsRun(
            `deployment rollback ${first.deployment_id ?? ""} --force --message restore`,
          ),
        );
      });

      it("reports on a dry run a listed origin the restored deployment leaves out", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        const first = await app.deployData();
        await app.addPrimaryOrigin("https://c.example.com");

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--dry-run",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            dry_run: true,
            title: `Would roll back to ${first.deployment_id} (dry run)`,
            deployment_id: first.deployment_id,
            dropped_origins: ["https://c.example.com"],
            restored_origins: [],
            unserved_origins: [],
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(`deployment rollback ${first.deployment_id ?? ""} --force`),
              ),
            ],
          },
          warnings: [
            `Rolling back to ${first.deployment_id} restores origins that leave out https://c.example.com: they would refuse sign-in until the next deploy.`,
          ],
        });
      });

      it("reports on a dry run a listed origin the restored deployment serves again", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        await app.addPrimaryOrigin("https://b.example.com");
        const first = await app.deployData();
        await app.removeOrigin("https://b.example.com");
        await app.deployData();
        await app.addPrimaryOrigin("https://b.example.com");

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--dry-run",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            dry_run: true,
            title: `Would roll back to ${first.deployment_id} (dry run)`,
            deployment_id: first.deployment_id,
            dropped_origins: [],
            restored_origins: ["https://b.example.com"],
            unserved_origins: [],
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(`deployment rollback ${first.deployment_id ?? ""} --force`),
              ),
            ],
          },
          warnings: [
            `Rolling back to ${first.deployment_id} includes https://b.example.com: they would serve its release again.`,
          ],
        });
      });

      it("keeps an origin the server put an escape sequence in as it came", async () => {
        const app = await aSetUpApp();
        const first = await app.deployData();
        const pattern = platform.admitsAHostileOriginPattern();

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--dry-run",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            dry_run: true,
            title: `Would roll back to ${first.deployment_id} (dry run)`,
            deployment_id: first.deployment_id,
            dropped_origins: [pattern],
            restored_origins: [],
            unserved_origins: ["http://localhost:3000"],
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(`deployment rollback ${first.deployment_id ?? ""} --force`),
              ),
            ],
          },
          warnings: [
            `Rolling back to ${first.deployment_id} restores origins that leave out ${pattern}: they would refuse sign-in until the next deploy.`,
          ],
        });
      });

      it("fails when there is no earlier deployment", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "deployment",
          "rollback",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "There is no earlier deployment to roll back to",
          hint: "Name a deployment to roll back to, or list the deployments to see which there are.",
          next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list"))],
        });
      });

      it("fails when nothing was ever deployed", async () => {
        const app = await anUndeployedEnvironment();

        const result = await app.run([
          "deployment",
          "rollback",
          "--env",
          "staging",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "There is no deployment to roll back",
          hint: "Nothing has been deployed yet; list the deployments to check.",
          next_commands: [
            expectedPublicCliCommand(
              `deployment list --env staging --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
            ),
          ],
        });
      });

      it("refuses a release id before asking to confirm it", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["deployment", "rollback", A_RELEASE, "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: "",
          code: "E_VALIDATION",
          message: INVALID_DEPLOYMENT_ID,
          hint: `Find one with ${expectedPublicCliCommand("deployment list")}, or omit it to undo the last deploy.`,
          next_commands: [expectedPublicCliCommand("deployment list")],
          details: { argument: "deployment_id" },
        });
      });

      it("refuses an id holding an escape sequence", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["deployment", "rollback", "dep_\u001b[2Jwiped", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: "",
          code: "E_VALIDATION",
          message: INVALID_DEPLOYMENT_ID,
          hint: `Find one with ${expectedPublicCliCommand("deployment list")}, or omit it to undo the last deploy.`,
          next_commands: [expectedPublicCliCommand("deployment list")],
          details: { argument: "deployment_id" },
        });
      });

      it("refuses a blank --message", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "deployment",
          "rollback",
          A_DEPLOYMENT,
          "--message",
          " ",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: "",
          code: "E_VALIDATION",
          message: "the value is empty",
          hint: "Pass a shorter summary with -m.",
          details: { argument: "--message" },
        });
      });

      it("stops on Ctrl-C while the server is not answering", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.run(["deployment", "rollback", A_DEPLOYMENT, "--force", "--json"]);
        await waiting;
        pressCtrlC();

        expect(await result).toFailWith("E_CANCELLED");
        expect(app.envelopeOf(await result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:rollback",
          source: MOCK_SERVER_URL,
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });

      it("never prints the project secret", async () => {
        const app = await aSetUpApp();
        const first = await app.deployData();

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--force",
          "--json",
        ]);

        const { ZITADEL_PROJECT_SECRET } = await app.developmentValues();
        expect(result.stdout + result.stderr).not.toContain(ZITADEL_PROJECT_SECRET);
      });

      describe("without --force when no one can be asked", () => {
        it("is refused, saying to pass --force", async () => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin();
          const first = await app.deployData();

          const result = await app.run([
            "deployment",
            "rollback",
            first.deployment_id ?? "",
            "--json",
          ]);

          expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "deployment:rollback",
            source: MOCK_SERVER_URL,
            code: "E_CONFIRMATION_REQUIRED",
            message: `Cannot roll back to ${first.deployment_id} without --force in non-interactive mode`,
            hint: expect.stringMatching(
              new RegExp(
                `^Ask a person first: Roll back to ${first.deployment_id} in project proj-[\\w-]+ on mock\\.zitadel\\.test so its release goes live again\\? Pass --force only once they agree\\.$`,
              ),
            ),
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(`deployment rollback ${first.deployment_id ?? ""} --force`),
              ),
            ],
            details: {
              question: expect.stringMatching(
                new RegExp(
                  `^Roll back to ${first.deployment_id} in project proj-[\\w-]+ on mock\\.zitadel\\.test so its release goes live again\\?$`,
                ),
              ),
            },
          });
        });

        it("says in the question which listed origin the rollback would stop serving", async () => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin("https://a.example.com");
          const first = await app.deployData();
          await app.addPrimaryOrigin("https://c.example.com");

          const result = await app.run([
            "deployment",
            "rollback",
            first.deployment_id ?? "",
            "--non-interactive",
            "--json",
          ]);

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "deployment:rollback",
            source: MOCK_SERVER_URL,
            code: "E_CONFIRMATION_REQUIRED",
            message: `Cannot roll back to ${first.deployment_id} without --force in non-interactive mode`,
            hint: expect.stringMatching(
              /^Ask a person first: Roll back to dep_[\w-]+ in project proj-[\w-]+ on mock\.zitadel\.test so its release goes live again, which makes https:\/\/c\.example\.com refuse sign-in until the next deploy\? Pass --force only once they agree\.$/,
            ),
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(`deployment rollback ${first.deployment_id ?? ""} --force`),
              ),
            ],
            details: {
              question: expect.stringMatching(
                /^Roll back to dep_[\w-]+ in project proj-[\w-]+ on mock\.zitadel\.test so its release goes live again, which makes https:\/\/c\.example\.com refuse sign-in until the next deploy\?$/,
              ),
            },
          });
        });

        it("says in the question which listed origin the rollback would serve again", async () => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin("https://a.example.com");
          await app.addPrimaryOrigin("https://b.example.com");
          const first = await app.deployData();
          await app.removeOrigin("https://b.example.com");
          await app.deployData();
          await app.addPrimaryOrigin("https://b.example.com");

          const result = await app.run([
            "deployment",
            "rollback",
            first.deployment_id ?? "",
            "--non-interactive",
            "--json",
          ]);

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "deployment:rollback",
            source: MOCK_SERVER_URL,
            code: "E_CONFIRMATION_REQUIRED",
            message: `Cannot roll back to ${first.deployment_id} without --force in non-interactive mode`,
            hint: expect.stringMatching(
              /^Ask a person first: Roll back to dep_[\w-]+ in project proj-[\w-]+ on mock\.zitadel\.test so its release goes live again, which makes https:\/\/b\.example\.com serve it again\? Pass --force only once they agree\.$/,
            ),
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(`deployment rollback ${first.deployment_id ?? ""} --force`),
              ),
            ],
            details: {
              question: expect.stringMatching(
                /^Roll back to dep_[\w-]+ in project proj-[\w-]+ on mock\.zitadel\.test so its release goes live again, which makes https:\/\/b\.example\.com serve it again\?$/,
              ),
            },
          });
        });

        it("carries an escape sequence the server put in an origin raw in the question", async () => {
          const app = await aSetUpApp();
          const first = await app.deployData();
          const pattern = platform.admitsAHostileOriginPattern();

          const result = await app.run([
            "deployment",
            "rollback",
            first.deployment_id ?? "",
            "--json",
          ]);

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "deployment:rollback",
            source: MOCK_SERVER_URL,
            code: "E_CONFIRMATION_REQUIRED",
            message: `Cannot roll back to ${first.deployment_id} without --force in non-interactive mode`,
            hint: expect.stringContaining(`which makes ${pattern} refuse sign-in`),
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(`deployment rollback ${first.deployment_id ?? ""} --force`),
              ),
            ],
            details: {
              question: expect.stringContaining(`which makes ${pattern} refuse sign-in`),
            },
          });
        });

        it.each(SERVERS)(
          "names the project and the server it would act on, for %s",
          async (_kind, server) => {
            const app = await aSetUpApp();
            await app.addPrimaryOrigin();
            const first = await app.deployData();

            const result = await app.runWithoutServer([
              "deployment",
              "rollback",
              first.deployment_id ?? "",
              "--server",
              server,
              "--json",
            ]);

            expect(result).toHintAt(await app.projectPlace(server));
          },
        );

        it("suggests running it again with --force", async () => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin();
          const first = await app.deployData();

          const result = await app.run([
            "deployment",
            "rollback",
            first.deployment_id ?? "",
            "--json",
          ]);

          expect(result).toSuggestExactly(
            app.againAsRun(`deployment rollback ${first.deployment_id ?? ""} --force`),
          );
        });

        it("suggests the deployment it resolved when none was named", async () => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin();
          const first = await app.deployData();
          await app.editUserSchema((schema) => {
            schema.properties.company = { type: "string" };
          });
          await app.deployData();

          const result = await app.run(["deployment", "rollback", "--json"]);

          expect(result).toSuggestExactly(
            app.againAsRun(`deployment rollback ${first.deployment_id ?? ""} --force`),
          );
        });

        it("suggests the deployment once when it is named after a flag", async () => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin();
          const first = await app.deployData();

          const result = await app.run([
            "deployment",
            "rollback",
            "--message",
            "restore",
            first.deployment_id ?? "",
            "--json",
          ]);

          expect(result).toSuggestExactly(
            app.againAsRun(
              `deployment rollback ${first.deployment_id ?? ""} --force --message restore`,
            ),
          );
        });

        it("rolls back nothing", async () => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin();
          const first = await app.deployData();
          await app.editUserSchema((schema) => {
            schema.properties.company = { type: "string" };
          });
          await app.deployData();
          const before = await app.liveDeploymentCount();

          await app.run(["deployment", "rollback", first.deployment_id ?? "", "--json"]);

          expect(await app.liveDeploymentCount()).toBe(before);
        });
      });
    });

    describe("rendered for a terminal", () => {
      it.each(RENDERINGS)("headlines the release it rolled back to, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        const first = await app.deployData();

        const result = await asTerminal(() =>
          app.run(
            ["deployment", "rollback", first.deployment_id ?? "", "--force", "--non-interactive"],
            colour,
          ),
        );

        expect(result).toPrint(`Rolled back to ${first.release_id}`);
      });

      it("names every origin it rolled back to, piped", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        const first = await app.deployData();
        await app.addPrimaryOrigin("https://c.example.com");

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--force",
          "--non-interactive",
        ]);

        expect(result).toPrint("Live on http://localhost:3000 and https://a.example.com.");
      });

      it("lists the revisions the release pins, piped", async () => {
        const app = await aSetUpApp();
        const first = await app.deployData();

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--force",
          "--non-interactive",
        ]);

        expect(result).toPrintRow("schema", "human-user");
      });

      it("says users keep the revision they have, piped", async () => {
        const app = await aSetUpApp();
        const first = await app.deployData();

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--force",
          "--non-interactive",
        ]);

        expect(result).toPrint(
          "Users keep the schema revision and attributes they have: a rollback does not migrate them back.",
        );
      });

      it("warns once of a listed origin the restored deployment leaves out", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        const first = await app.deployData();
        await app.addPrimaryOrigin("https://c.example.com");

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--force",
          "--non-interactive",
        ]);

        expect(result).toSayOnce("leave out https://c.example.com");
      });

      it("warns once on a dry run of a listed origin the restored deployment leaves out", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        const first = await app.deployData();
        await app.addPrimaryOrigin("https://c.example.com");

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--dry-run",
          "--non-interactive",
        ]);

        expect(result).toSayOnce("leave out https://c.example.com");
      });

      it("headlines a dry run as one", async () => {
        const app = await aSetUpApp();
        const first = await app.deployData();

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--dry-run",
          "--non-interactive",
        ]);

        expect(result).toPrint(`Would roll back to ${first.deployment_id} (dry run)`);
      });

      it("suggests the real rollback after a dry run, once", async () => {
        const app = await aSetUpApp();
        const first = await app.deployData();

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--dry-run",
          "--non-interactive",
        ]);

        expect(result).toSayOnce(`deployment rollback ${first.deployment_id} --force`);
      });

      it("spells out an escape sequence the server put in an origin, in the warning", async () => {
        const app = await aSetUpApp();
        const first = await app.deployData();
        platform.admitsAHostileOriginPattern();

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--dry-run",
          "--non-interactive",
        ]);

        expect(result.stdout + result.stderr).toContain("https://admitted.acme.com\\x1b[2Jwiped");
        expect(result.stdout + result.stderr).not.toContain("\u001b[2J");
      });

      it("spells out an escape sequence the server put in an origin, in the question", async () => {
        const app = await aSetUpApp();
        const first = await app.deployData();
        platform.admitsAHostileOriginPattern();

        const result = await app.run(["deployment", "rollback", first.deployment_id ?? ""]);

        expect(result.stdout + result.stderr).toContain("https://admitted.acme.com\\x1b[2Jwiped");
        expect(result.stdout + result.stderr).not.toContain("\u001b[2J");
      });

      it("refuses without --force, saying so once with the command to run", async () => {
        const app = await aSetUpApp();
        const first = await app.deployData();

        const result = await app.run(["deployment", "rollback", first.deployment_id ?? ""]);

        expect(result).toSayOnce(`deployment rollback ${first.deployment_id} --force`);
      });

      it("explains why there is no earlier deployment", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["deployment", "rollback", "--force", "--non-interactive"]);

        expect(result).toSay("There is no earlier deployment to roll back to");
      });
    });
  });
});
