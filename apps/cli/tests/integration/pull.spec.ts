import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import {
  aFreshCheckoutHoldingARefusedSchemaOf,
  aFreshCheckoutOf,
  anUndeployedEnvironment,
  aSetUpApp,
  MOCK_SERVER_URL,
} from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";

const platform = usePlatformMock();

const PINNED = [
  {
    kind: "schema",
    handle: "human-user",
    path: ".zitadel/schemas/human-user.json",
  },
  {
    kind: "flow_definition",
    handle: "default-login",
    path: ".zitadel/flows/default-login.json",
  },
];

const SKIPPED = [
  { kind: "policy", handle: "auth.factor.password.set" },
  { kind: "policy", handle: "user.create" },
];

const SKIPPED_WARNINGS = [
  'The release pins policy "auth.factor.password.set", which pull cannot rebuild locally yet; reconcile it by hand.',
  'The release pins policy "user.create", which pull cannot rebuild locally yet; reconcile it by hand.',
];

describe("pull", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["pull", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "pull",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: expect.stringMatching(
            /^GET http:\/\/mock\.zitadel\.test\/api\/v1\/deployments\?project_id=proj-[0-9a-f]+&live=true returned 404/,
          ),
          details: {
            status: 404,
            url: expect.stringMatching(
              /\/api\/v1\/deployments\?project_id=proj-[0-9a-f]+&live=true$/,
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

        const result = await app.run(["pull", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "pull",
          source: MOCK_SERVER_URL,
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(
              /\/api\/v1\/deployments\?project_id=proj-[0-9a-f]+&live=true$/,
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

        const result = app.run(["pull", "--json"]);
        await waiting;
        pressCtrlC();

        expect(app.envelopeOf(await result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "pull",
          source: MOCK_SERVER_URL,
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });

      it("exits 130", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.run(["pull", "--json"]);
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
      await app.setVariable("HOST", "app.acme.com");
      await app.deployData();
      platform.servesAHostileOrigin();
      const args = ["pull"];

      await app.inEveryRendering((how) => {
        return app.run(how.json ? [...args, "--json"] : args, how.env);
      });
    });

    describe("--json", () => {
      it("rebuilds the live release into a fresh checkout", async () => {
        const project = await aSetUpApp();
        const deployed = await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", "--json"]);

        expect(checkout.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "pull",
          source: MOCK_SERVER_URL,
          data: {
            title: `Pulled 2 files from ${deployed.release_id}`,
            release_id: deployed.release_id,
            pulled: PINNED,
            skipped: SKIPPED,
            next_commands: [
              expectedPublicCliCommand(checkout.againAsRun("deploy --message '<what changed>'")),
            ],
          },
          warnings: SKIPPED_WARNINGS,
        });
      });

      it("rebuilds a .zitadel the fresh checkout can deploy back", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        await checkout.run(["pull", "--json"]);

        expect(await checkout.deploy()).toSucceed();
      });

      it("succeeds over a local schema its contract refuses", async () => {
        const project = await aSetUpApp();
        const deployed = await project.deployData();
        const checkout = await aFreshCheckoutHoldingARefusedSchemaOf(project);

        const result = await checkout.run(["pull", "--json"]);

        expect(checkout.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "pull",
          source: MOCK_SERVER_URL,
          data: {
            title: `Pulled 2 files from ${deployed.release_id}`,
            release_id: deployed.release_id,
            pulled: [
              {
                kind: "schema",
                handle: "human-user",
                path: ".zitadel/schemas/default-human-user.json",
              },
              PINNED[1],
            ],
            skipped: SKIPPED,
            next_commands: [
              expectedPublicCliCommand(checkout.againAsRun("deploy --message '<what changed>'")),
            ],
          },
          warnings: SKIPPED_WARNINGS,
        });
      });

      it("replaces a local schema its contract refuses so the checkout deploys", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutHoldingARefusedSchemaOf(project);

        await checkout.run(["pull", "--json"]);

        expect(await checkout.deploy()).toSucceed();
      });

      it("pulls the release a release id names", async () => {
        const project = await aSetUpApp();
        const deployed = await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", deployed.release_id ?? "", "--json"]);

        expect(checkout.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "pull",
          source: MOCK_SERVER_URL,
          data: {
            title: `Pulled 2 files from ${deployed.release_id}`,
            release_id: deployed.release_id,
            pulled: PINNED,
            skipped: SKIPPED,
            next_commands: [],
          },
          warnings: SKIPPED_WARNINGS,
        });
      });

      it("pulls the release a deployment id names", async () => {
        const project = await aSetUpApp();
        const deployed = await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", deployed.deployment_id ?? "", "--json"]);

        expect(checkout.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "pull",
          source: MOCK_SERVER_URL,
          data: {
            title: `Pulled 2 files from ${deployed.release_id}`,
            release_id: deployed.release_id,
            pulled: PINNED,
            skipped: SKIPPED,
            next_commands: [],
          },
          warnings: SKIPPED_WARNINGS,
        });
      });

      it("pulls the release a deployment id names with a credential that may not read variables", async () => {
        const project = await aSetUpApp();
        const deployed = await project.deployData();
        const checkout = await aFreshCheckoutOf(project);
        platform.refusesVariableReads();

        const result = await checkout.run(["pull", deployed.deployment_id ?? "", "--json"]);

        expect(checkout.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "pull",
          source: MOCK_SERVER_URL,
          data: {
            title: `Pulled 2 files from ${deployed.release_id}`,
            release_id: deployed.release_id,
            pulled: PINNED,
            skipped: SKIPPED,
            next_commands: [],
          },
          warnings: SKIPPED_WARNINGS,
        });
      });

      it("fails when nothing is deployed to pull", async () => {
        const project = await anUndeployedEnvironment();

        const result = await project.run(["pull", "--env", "staging", "--json"]);

        expect(project.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "pull",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: "Nothing is deployed to a primary origin yet",
          hint: `Deploy first with ${expectedPublicCliCommand(`deploy --message '<what changed>' --env staging --server ${MOCK_SERVER_URL} --cwd ${project.path}`)}, then pull.`,
        });
      });

      it("fails for a release the server does not hold", async () => {
        const project = await aSetUpApp();

        const result = await project.run(["pull", "rel_nope", "--json"]);

        expect(project.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "pull",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: "release: not found",
          details: {
            status: 404,
            url: expect.stringMatching(/\/api\/v1\/releases\/rel_nope\?project_id=proj-[0-9a-f]+$/),
            body: { code: "rel.not_found", message: "release: not found" },
          },
        });
      });

      it("fails for a deployment the server does not hold", async () => {
        const project = await aSetUpApp();

        const result = await project.run(["pull", "dep_nope", "--json"]);

        expect(project.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "pull",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: "deployment: not found",
          details: {
            status: 404,
            url: expect.stringMatching(
              /\/api\/v1\/deployments\/dep_nope\?project_id=proj-[0-9a-f]+$/,
            ),
            body: { code: "dep.not_found", message: "deployment: not found" },
          },
        });
      });

      it("rejects a target that is neither latest nor an id", async () => {
        const project = await aSetUpApp();

        const result = await project.run(["pull", "whatever", "--json"]);

        expect(project.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "pull",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: 'Don\'t know how to pull "whatever".',
          hint: "Pass 'latest', a release id (rel_…), or a deployment id (dep_…).",
        });
      });

      it("rejects a target holding an escape sequence, keeping it raw", async () => {
        const project = await aSetUpApp();

        const result = await project.run(["pull", "whatever\u001b[2J", "--json"]);

        expect(project.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "pull",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: 'Don\'t know how to pull "whatever\u001b[2J".',
          hint: "Pass 'latest', a release id (rel_…), or a deployment id (dep_…).",
        });
      });

      it("rejects a release id holding an escape sequence before asking the server", async () => {
        const project = await aSetUpApp();

        const result = await project.run(["pull", "rel_\u001b[2J", "--json"]);

        expect(project.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "pull",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: 'Don\'t know how to pull "rel_\u001b[2J".',
          hint: "Pass 'latest', a release id (rel_…), or a deployment id (dep_…).",
        });
      });

      describe("under --dry-run", () => {
        it("lists what it would write", async () => {
          const project = await aSetUpApp();
          const deployed = await project.deployData();
          const checkout = await aFreshCheckoutOf(project);

          const result = await checkout.run(["pull", "--dry-run", "--json"]);

          expect(checkout.envelopeOf(result)).toEqual({
            status: "ok",
            cli_version: cliVersion.version,
            command: "pull",
            source: MOCK_SERVER_URL,
            data: {
              title: `Would write 2 files from ${deployed.release_id} (dry run)`,
              release_id: deployed.release_id,
              pulled: PINNED,
              skipped: SKIPPED,
              dry_run: true,
              next_commands: [expectedPublicCliCommand(checkout.againAsRun("pull"))],
            },
            warnings: SKIPPED_WARNINGS,
          });
        });

        it("keeps the target it was given on the real command it suggests", async () => {
          const project = await aSetUpApp();
          const deployed = await project.deployData();
          const checkout = await aFreshCheckoutOf(project);

          const result = await checkout.run([
            "pull",
            deployed.release_id ?? "",
            "--dry-run",
            "--json",
          ]);

          expect(checkout.envelopeOf(result)).toEqual({
            status: "ok",
            cli_version: cliVersion.version,
            command: "pull",
            source: MOCK_SERVER_URL,
            data: {
              title: `Would write 2 files from ${deployed.release_id} (dry run)`,
              release_id: deployed.release_id,
              pulled: PINNED,
              skipped: SKIPPED,
              dry_run: true,
              next_commands: [
                expectedPublicCliCommand(checkout.againAsRun(`pull ${deployed.release_id}`)),
              ],
            },
            warnings: SKIPPED_WARNINGS,
          });
        });

        it("writes nothing a deploy could publish", async () => {
          const project = await aSetUpApp();
          await project.deployData();
          const checkout = await aFreshCheckoutOf(project);

          await checkout.run(["pull", "--dry-run", "--json"]);

          expect(await checkout.deploy()).toFail();
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says what it wrote", async () => {
        const project = await aSetUpApp();
        const deployed = await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull"]);

        expect(result).toPrint(`Pulled 2 files from ${deployed.release_id}`);
      });

      it("lists every file it wrote", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull"]);

        expect(result).toPrint(
          "Files written:\n  .zitadel/schemas/human-user.json\n  .zitadel/flows/default-login.json",
        );
      });

      it("suggests a deploy once", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull"]);

        expect(result).toSayOnce(
          expectedPublicCliCommand(checkout.againAsRun("deploy --message '<what changed>'")),
        );
      });

      it.each(SKIPPED_WARNINGS)("warns once that %s", async (warning) => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull"]);

        expect(result).toSayOnce(warning);
      });

      it("headlines a dry run the way it headlines it in JSON", async () => {
        const project = await aSetUpApp();
        const deployed = await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", "--dry-run"]);

        expect(result).toPrint(`Would write 2 files from ${deployed.release_id} (dry run)`);
      });

      it("lists the files a dry run would write", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", "--dry-run"]);

        expect(result).toPrint(
          "Files it would write:\n  .zitadel/schemas/human-user.json\n  .zitadel/flows/default-login.json",
        );
      });

      it("suggests the real pull after a dry run once", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", "--dry-run"]);

        expect(result).toSayOnce(expectedPublicCliCommand(checkout.againAsRun("pull")));
      });

      it("spells out an escape sequence in a target it refuses", async () => {
        const project = await aSetUpApp();

        const result = await project.run(["pull", "whatever\u001b[2J"]);

        expect(result).toSay('Don\'t know how to pull "whatever\\x1b[2J".');
      });

      it("says nothing is deployed without a full stop", async () => {
        const project = await anUndeployedEnvironment();

        const result = await project.run(["pull", "--env", "staging"]);

        expect(result).toSay("Nothing is deployed to a primary origin yet (E_NOT_FOUND)");
      });
    });
  });
});
