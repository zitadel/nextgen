import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, MOCK_SERVER_URL, type ScaffoldedApp } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";

const platform = usePlatformMock();

const GOOGLE = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

type Release = { release_id: string; content_hash: string; resources: number };

function createRelease(app: ScaffoldedApp) {
  return app.run(["release", "create", "--non-interactive", "--json"]);
}

describe("release create", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await createRelease(app);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "release:create",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: expect.stringMatching(
            /^POST http:\/\/mock\.zitadel\.test\/api\/v1\/releases\/build\?project_id=proj-[0-9a-f]+ returned 404/,
          ),
          details: {
            status: 404,
            url: expect.stringMatching(/\/api\/v1\/releases\/build\?project_id=proj-[0-9a-f]+$/),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await createRelease(app);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "release:create",
          source: MOCK_SERVER_URL,
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(/\/api\/v1\/releases\/build\?project_id=proj-[0-9a-f]+$/),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = createRelease(app);
        await waiting;
        pressCtrlC();

        expect(app.envelopeOf(await result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "release:create",
          source: MOCK_SERVER_URL,
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });

      it("exits 130", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = createRelease(app);
        await waiting;
        pressCtrlC();

        expect(await result).toExitWith(130);
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      platform.buildsAReleaseWithAHostileHash();
      const args = ["release", "create", "-m", "in every rendering"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("builds a release from the config without deploying it", async () => {
        const app = await aSetUpApp();

        const result = await createRelease(app);

        const { data } = app.envelopeOf<Release>(result);
        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "release:create",
          source: MOCK_SERVER_URL,
          data: {
            title: `Created ${data.release_id}`,
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            resources: 4,
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(`deployment create --release ${data.release_id}`),
              ),
            ],
          },
          warnings: [],
        });
      });

      it("deploys nothing", async () => {
        const app = await aSetUpApp();
        const before = await app.liveDeploymentCount();

        await createRelease(app);

        expect(await app.liveDeploymentCount()).toBe(before);
      });

      it("records the message it was given", async () => {
        const app = await aSetUpApp();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });

        const result = await app.run([
          "release",
          "create",
          "-m",
          "add a company",
          "--non-interactive",
          "--json",
        ]);

        expect(await app.releaseMessage(app.envelopeOf<Release>(result).data.release_id)).toBe(
          "add a company",
        );
      });

      it("registers a new sign-in provider the release names", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", GOOGLE);

        const result = await createRelease(app);

        const { data } = app.envelopeOf<Release>(result);
        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "release:create",
          source: MOCK_SERVER_URL,
          data: {
            title: `Created ${data.release_id}`,
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            resources: 5,
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(`deployment create --release ${data.release_id}`),
              ),
            ],
          },
          warnings: [],
        });
        expect((await app.registeredIdps()).map((idp) => idp.slug)).toEqual(["google"]);
      });

      it("refuses content that builds back to a revoked release", async () => {
        const app = await aSetUpApp();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        const first = app.envelopeOf<Release>(await createRelease(app)).data;
        await app.run([
          "release",
          "revoke",
          first.release_id,
          "--force",
          "--non-interactive",
          "--json",
        ]);

        const result = await createRelease(app);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "release:create",
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

      it("returns the same release for the same content", async () => {
        const app = await aSetUpApp();
        const first = app.envelopeOf<Release>(await createRelease(app)).data;

        const again = await createRelease(app);

        expect(app.envelopeOf(again)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "release:create",
          source: MOCK_SERVER_URL,
          data: {
            title: `Created ${first.release_id}`,
            release_id: first.release_id,
            content_hash: first.content_hash,
            resources: 4,
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(`deployment create --release ${first.release_id}`),
              ),
            ],
          },
          warnings: [],
        });
      });

      it("keeps a hostile content hash raw", async () => {
        const app = await aSetUpApp();
        const hash = platform.buildsAReleaseWithAHostileHash();

        const result = await createRelease(app);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "release:create",
          source: MOCK_SERVER_URL,
          data: {
            title: "Created rel_1",
            release_id: "rel_1",
            content_hash: hash,
            resources: 4,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("deployment create --release rel_1")),
            ],
          },
          warnings: [],
        });
      });

      it("prints no secret", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", GOOGLE);

        const result = await createRelease(app);

        expect(result.stdout + result.stderr).not.toContain(GOOGLE.secret);
      });

      describe("under --dry-run", () => {
        it("validates the bundle and builds no release", async () => {
          const app = await aSetUpApp();

          const result = await app.run([
            "release",
            "create",
            "--dry-run",
            "--non-interactive",
            "--json",
          ]);

          expect(app.envelopeOf(result)).toEqual({
            status: "ok",
            cli_version: cliVersion.version,
            command: "release:create",
            source: MOCK_SERVER_URL,
            data: {
              dry_run: true,
              title: "Validated 4 resources and created no release (dry run)",
              resources: 4,
              next_commands: [expectedPublicCliCommand(app.againAsRun("release create"))],
            },
            warnings: [],
          });
        });

        it("keeps the message it was typed with on the real command it suggests", async () => {
          const app = await aSetUpApp();

          const result = await app.run([
            "release",
            "create",
            "--dry-run",
            "-m",
            "add a company",
            "--non-interactive",
            "--json",
          ]);

          expect(app.envelopeOf(result)).toEqual({
            status: "ok",
            cli_version: cliVersion.version,
            command: "release:create",
            source: MOCK_SERVER_URL,
            data: {
              dry_run: true,
              title: "Validated 4 resources and created no release (dry run)",
              resources: 4,
              next_commands: [
                expectedPublicCliCommand(
                  app.againAsRun("release create --message 'add a company'"),
                ),
              ],
            },
            warnings: [],
          });
        });

        it("builds no release", async () => {
          const app = await aSetUpApp();
          await app.editUserSchema((schema) => {
            schema.properties.company = { type: "string" };
          });
          const before = app.envelopeOf<{ count: number }>(
            await app.run(["release", "list", "--json"]),
          ).data.count;

          await app.run(["release", "create", "--dry-run", "--non-interactive", "--json"]);

          expect(
            app.envelopeOf<{ count: number }>(await app.run(["release", "list", "--json"])).data
              .count,
          ).toBe(before);
        });

        it("registers no sign-in provider", async () => {
          const app = await aSetUpApp();
          await app.enableSso("google", GOOGLE);

          await app.run(["release", "create", "--dry-run", "--non-interactive", "--json"]);

          expect(await app.registeredIdps()).toEqual([]);
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("names the release it created", async () => {
        const app = await aSetUpApp();
        const created = app.envelopeOf<Release>(await createRelease(app)).data;

        const result = await app.run(["release", "create", "--non-interactive"]);

        expect(result).toPrint(`Created ${created.release_id}`);
      });

      it("suggests deploying the release it created once", async () => {
        const app = await aSetUpApp();
        const created = app.envelopeOf<Release>(await createRelease(app)).data;

        const result = await app.run(["release", "create", "--non-interactive"]);

        expect(result).toSayOnce(
          expectedPublicCliCommand(
            app.againAsRun(`deployment create --release ${created.release_id}`),
          ),
        );
      });

      it("headlines a dry run the way it headlines it in JSON", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["release", "create", "--dry-run", "--non-interactive"]);

        expect(result).toPrint("Validated 4 resources and created no release (dry run)");
      });

      it("suggests the real command after a dry run once", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["release", "create", "--dry-run", "--non-interactive"]);

        expect(result).toSayOnce(expectedPublicCliCommand(app.againAsRun("release create")));
      });
    });
  });
});
