import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, MOCK_SERVER_URL, type ScaffoldedApp } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";

const SERVERS = [
  ["a remote server", "http://mock.zitadel.test"],
  ["a local server", "http://localhost:8112"],
];

const A_RELEASE_ID = "rel_01KX3RG8A7F0N9WD3P2E4YM5C1";

const platform = usePlatformMock();

/** Build a release and return its id. */
async function aRelease(app: ScaffoldedApp): Promise<string> {
  // Setup deployed the scaffolded config, so the release is built from an
  // edit of it: one nothing serves.
  await app.editUserSchema((schema) => {
    schema.properties.company = { type: "string" };
  });
  const result = await app.run(["release", "create", "--non-interactive", "--json"]);
  expect(result, "arranging a release should have succeeded").toSucceed();
  return app.envelopeOf<{ release_id: string }>(result).data.release_id;
}

describe("release revoke", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run([
          "release",
          "revoke",
          A_RELEASE_ID,
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "release:revoke",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: expect.stringMatching(
            new RegExp(
              `^POST http://mock\\.zitadel\\.test/api/v1/releases/${A_RELEASE_ID}/revoke\\?project_id=proj-[0-9a-f]+ returned 404`,
            ),
          ),
          details: {
            status: 404,
            url: expect.stringMatching(
              new RegExp(`/api/v1/releases/${A_RELEASE_ID}/revoke\\?project_id=proj-[0-9a-f]+$`),
            ),
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
          "release",
          "revoke",
          A_RELEASE_ID,
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "release:revoke",
          source: MOCK_SERVER_URL,
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(
              new RegExp(`/api/v1/releases/${A_RELEASE_ID}/revoke\\?project_id=proj-[0-9a-f]+$`),
            ),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.run([
          "release",
          "revoke",
          A_RELEASE_ID,
          "--force",
          "--non-interactive",
          "--json",
        ]);
        await waiting;
        pressCtrlC();

        expect(app.envelopeOf(await result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "release:revoke",
          source: MOCK_SERVER_URL,
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });

      it("exits 130", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.run([
          "release",
          "revoke",
          A_RELEASE_ID,
          "--force",
          "--non-interactive",
          "--json",
        ]);
        await waiting;
        pressCtrlC();

        expect(await result).toExitWith(130);
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      const args = ["release", "revoke", await aRelease(app), "--force"];
      platform.revokesAHostileReleaseId();

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    it("holds its invariants in every rendering of a refusal naming a hostile origin", async () => {
      const app = await aSetUpApp();
      const args = ["release", "revoke", await aRelease(app), "--force"];
      platform.refusesRevokeNamingAHostileOrigin();

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("refuses a deployment id, which is not a release id, without asking", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "release",
          "revoke",
          "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "release:revoke",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message:
            "Invalid release_id: must be a release ID: rel_ followed by letters, digits, _ or -",
          hint: "List the releases to find one.",
          next_commands: [
            expectedPublicCliCommand(`release list --server ${MOCK_SERVER_URL} --cwd ${app.path}`),
          ],
          details: { argument: "release_id" },
        });
      });

      it("refuses an id holding an escape sequence without echoing it", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["release", "revoke", "rel_\u001b[2J", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "release:revoke",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message:
            "Invalid release_id: must be a release ID: rel_ followed by letters, digits, _ or -",
          hint: "List the releases to find one.",
          next_commands: [
            expectedPublicCliCommand(`release list --server ${MOCK_SERVER_URL} --cwd ${app.path}`),
          ],
          details: { argument: "release_id" },
        });
      });

      it("revokes a release nothing serves", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);

        const result = await app.run([
          "release",
          "revoke",
          releaseId,
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "release:revoke",
          source: MOCK_SERVER_URL,
          data: {
            title: `Revoked ${releaseId}`,
            release_id: releaseId,
            revoked: true,
            revoked_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
          },
          warnings: [],
        });
      });

      it("answers a second revoke of the same release with the same envelope", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);
        const first = app.envelopeOf(
          await app.run(["release", "revoke", releaseId, "--force", "--non-interactive", "--json"]),
        );

        const result = await app.run([
          "release",
          "revoke",
          releaseId,
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual(first);
      });

      it("keeps an escape sequence the server put in the release id raw", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);
        platform.revokesAHostileReleaseId();

        const result = await app.run([
          "release",
          "revoke",
          releaseId,
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "release:revoke",
          source: MOCK_SERVER_URL,
          data: {
            title: "Revoked rel-\\x1b[2Jwiped",
            release_id: "rel-\u001b[2Jwiped",
            revoked: true,
            revoked_at: "2026-01-01T00:00:00Z",
          },
          warnings: [],
        });
      });

      it("refuses to revoke a release an origin still serves", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const served = await app.deployData();

        const result = await app.run([
          "release",
          "revoke",
          served.release_id ?? "",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "release:revoke",
          source: MOCK_SERVER_URL,
          code: "E_CONFLICT",
          message: "release: still served by an origin",
          hint: expect.any(String),
          next_commands: expect.any(Array),
          details: {
            release_id: served.release_id,
            origins: [
              {
                origin: "http://localhost:3000",
                deployment_id: served.deployment_id,
                kind: "primary",
              },
              {
                origin: "https://app.example.com",
                deployment_id: served.deployment_id,
                kind: "primary",
              },
            ],
          },
        });
      });

      it("revokes nothing when an origin still serves the release", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const served = await app.deployData();

        await app.run([
          "release",
          "revoke",
          served.release_id ?? "",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(await app.deploy()).toSucceed();
      });

      it("refuses a release the server does not hold", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "release",
          "revoke",
          A_RELEASE_ID,
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "release:revoke",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: "release: not found",
          details: {
            status: 404,
            url: expect.stringMatching(
              new RegExp(`/api/v1/releases/${A_RELEASE_ID}/revoke\\?project_id=proj-[0-9a-f]+$`),
            ),
            body: { code: "rel.not_found", message: "release: not found" },
          },
        });
      });

      describe("under --dry-run", () => {
        it("reports what it would revoke, needing no --force", async () => {
          const app = await aSetUpApp();
          const releaseId = await aRelease(app);

          const result = await app.run([
            "release",
            "revoke",
            releaseId,
            "--dry-run",
            "--non-interactive",
            "--json",
          ]);

          expect(app.envelopeOf(result)).toEqual({
            status: "ok",
            cli_version: cliVersion.version,
            command: "release:revoke",
            source: MOCK_SERVER_URL,
            data: {
              dry_run: true,
              title: `Would revoke ${releaseId} (dry run)`,
              release_id: releaseId,
              next_commands: [
                expectedPublicCliCommand(app.againAsRun(`release revoke ${releaseId} --force`)),
              ],
            },
            warnings: [],
          });
        });

        it("revokes nothing", async () => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin();
          const releaseId = await aRelease(app);

          await app.run([
            "release",
            "revoke",
            releaseId,
            "--dry-run",
            "--non-interactive",
            "--json",
          ]);

          expect(
            await app.run([
              "deployment",
              "create",
              "--release",
              releaseId,
              "--non-interactive",
              "--json",
            ]),
          ).toSucceed();
        });
      });

      describe("without --force when no one can be asked", () => {
        it("is refused", async () => {
          const app = await aSetUpApp();
          const releaseId = await aRelease(app);

          const result = await app.run(["release", "revoke", releaseId, "--json"]);

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "release:revoke",
            source: MOCK_SERVER_URL,
            code: "E_CONFIRMATION_REQUIRED",
            message: `Cannot revoke ${releaseId} without --force in non-interactive mode`,
            hint: `Ask a person first: Revoke ${releaseId} in ${await app.projectPlace()} so its content can never be served again? Pass --force only once they agree.`,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun(`release revoke ${releaseId} --force`)),
            ],
            details: {
              question: `Revoke ${releaseId} in ${await app.projectPlace()} so its content can never be served again?`,
            },
          });
        });

        it.each(SERVERS)(
          "names the project and the server it would act on, for %s",
          async (_kind, server) => {
            const app = await aSetUpApp();
            const releaseId = await aRelease(app);

            const result = await app.runWithoutServer([
              "release",
              "revoke",
              releaseId,
              "--server",
              server,
              "--json",
            ]);

            expect(app.envelopeOf(result)).toEqual({
              status: "error",
              cli_version: cliVersion.version,
              command: "release:revoke",
              source: server,
              code: "E_CONFIRMATION_REQUIRED",
              message: `Cannot revoke ${releaseId} without --force in non-interactive mode`,
              hint: `Ask a person first: Revoke ${releaseId} in ${await app.projectPlace(server)} so its content can never be served again? Pass --force only once they agree.`,
              next_commands: [
                expectedPublicCliCommand(
                  `release revoke ${releaseId} --force --server ${server} --cwd ${app.path}`,
                ),
              ],
              details: {
                question: `Revoke ${releaseId} in ${await app.projectPlace(server)} so its content can never be served again?`,
              },
            });
          },
        );

        it("revokes nothing", async () => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin();
          const releaseId = await aRelease(app);

          await app.run(["release", "revoke", releaseId, "--json"]);

          expect(
            await app.run(["deployment", "create", "--release", releaseId, "--json"]),
          ).toSucceed();
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("names the release it revoked", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);

        const result = await app.run([
          "release",
          "revoke",
          releaseId,
          "--force",
          "--non-interactive",
        ]);

        expect(result).toPrint(`Revoked ${releaseId}`);
      });

      it("spells out an escape sequence the server put in the release id", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);
        platform.revokesAHostileReleaseId();

        const result = await app.run([
          "release",
          "revoke",
          releaseId,
          "--force",
          "--non-interactive",
        ]);

        expect(result).toPrint("Revoked rel-\\x1b[2Jwiped");
      });

      it("prints no raw escape sequence for an id the server mangled", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);
        platform.revokesAHostileReleaseId();

        const result = await app.run([
          "release",
          "revoke",
          releaseId,
          "--force",
          "--non-interactive",
        ]);

        expect(result.stdout + result.stderr).not.toContain("\u001b[2J");
      });

      it("headlines a dry run the way it headlines it in JSON", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);

        const result = await app.run([
          "release",
          "revoke",
          releaseId,
          "--dry-run",
          "--non-interactive",
        ]);

        expect(result).toPrint(`Would revoke ${releaseId} (dry run)`);
      });

      it("suggests revoking for real after a dry run once", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);

        const result = await app.run([
          "release",
          "revoke",
          releaseId,
          "--dry-run",
          "--non-interactive",
        ]);

        expect(result).toSayOnce(
          expectedPublicCliCommand(app.againAsRun(`release revoke ${releaseId} --force`)),
        );
      });

      it("refuses without --force, saying so once, and suggests running it again with --force", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);

        const result = await app.run(["release", "revoke", releaseId, "--non-interactive"]);

        expect(result).toSayOnce(
          expectedPublicCliCommand(app.againAsRun(`release revoke ${releaseId} --force`)),
        );
      });

      it("states the confirmation question once", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);

        const result = await app.run(["release", "revoke", releaseId, "--non-interactive"]);

        expect(result).toSayOnce(
          `Revoke ${releaseId} in ${await app.projectPlace()} so its content can never be served again?`,
        );
      });
    });
  });
});
