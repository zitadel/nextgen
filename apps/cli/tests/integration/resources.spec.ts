import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp, MOCK_SERVER_URL, PASSWORD_POLICY } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";

const SERVERS = [
  ["a remote server", "http://mock.zitadel.test"],
  ["a local server", "http://localhost:8112"],
];

const platform = usePlatformMock();

interface ResourceRow {
  readonly topic: string;
  readonly verbs?: string[];
}

const ACME_CONNECTION_FLAGS = [
  "--slug",
  "acme-sso",
  "--protocol",
  "oidc",
  "--display-name",
  "Acme SSO",
  "--oidc-issuer",
  "https://sso.acme.example",
  "--oidc-client-id",
  "abc123",
  "--oidc-client-secret",
  "${{ ACME_SSO_CLIENT_SECRET }}",
  "--oidc-scopes",
  "openid",
];

const DESTRUCTIVE = [
  ["users", "delete", "user_1", "Cannot delete user user_1", "Delete user user_1"],
  ["teams", "deactivate", "team_1", "Cannot deactivate team team_1", "Deactivate team team_1"],
  ["sessions", "revoke", "sess_1", "Cannot revoke session sess_1", "Revoke session sess_1"],
];

const WRONG_KIND: readonly { args: string[]; list: string; message: string }[] = [
  {
    args: ["users", "get", "rel_01M6KPFXAE68N6G2X1HN5XD29R"],
    list: "users list",
    message: "Invalid id: must be a user ID: user_ followed by letters, digits, _ or -",
  },
  {
    args: ["sessions", "get", "user_01KX5N7C9D2E7F0N9WD3P2E4YM6"],
    list: "sessions list",
    message: "Invalid id: must be a session ID: sess_ followed by letters, digits, _ or -",
  },
  {
    args: ["release", "get", "sess_01KX5N7C9D2E7F0N9WD3P2E4YM6"],
    list: "release list",
    message: "Invalid id: must be a release ID: rel_ followed by letters, digits, _ or -",
  },
];

describe("resources", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["resources", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "resources",
          source: "",
          status: "ok",
          data: { items: expect.any(Array), count: expect.any(Number), next_page_token: null },
          warnings: [],
        });
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["resources", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "resources",
          source: "",
          status: "ok",
          data: { items: expect.any(Array), count: expect.any(Number), next_page_token: null },
          warnings: [],
        });
      });
    });

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["resources", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "resources",
          source: "",
          status: "ok",
          data: { items: expect.any(Array), count: expect.any(Number), next_page_token: null },
          warnings: [],
        });
      });
    });
  });

  describe("a generated command", () => {
    describe("against a server that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["idps", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "idps:list",
          source: MOCK_SERVER_URL,
          code: "E_NETWORK",
          message: expect.stringMatching(
            /^POST http:\/\/mock\.zitadel\.test\/api\/v1\/idps\/query\?project_id=proj-\S+ got no response$/,
          ),
          hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
          details: {
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/idps\/query\?project_id=proj-/,
            ),
            reason: "unreachable",
          },
        });
      });
    });

    describe("against a server that hangs", () => {
      it("stops on Ctrl-C", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.run(["idps", "list", "--json"]);
        await waiting;
        pressCtrlC();

        expect(await result).toFailWith("E_CANCELLED");
        expect(app.envelopeOf(await result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "idps:list",
          source: MOCK_SERVER_URL,
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["resources"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("lists what the CLI manages before the project is set up", async () => {
        const app = await anApp();

        const result = await app.run(["resources", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "resources",
          source: "",
          status: "ok",
          data: { items: expect.any(Array), count: expect.any(Number), next_page_token: null },
          warnings: [],
        });
      });

      it("names every topic the resource commands are generated for", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--json"]);

        const { data } = app.envelopeOf<{ items: ResourceRow[] }>(result);
        expect(data.items.map((row) => row.topic)).toEqual(
          expect.arrayContaining(["users", "teams", "sessions", "idps", "schemas"]),
        );
      });

      it("counts the topics it lists", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--json"]);

        const { data } = app.envelopeOf<{ items: ResourceRow[]; count: number }>(result);
        expect(data.count).toBe(data.items.length);
      });

      it("describes a topic that cannot be paged", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--json"]);

        const { data } = app.envelopeOf<{ items: ResourceRow[] }>(result);
        expect(data.items.filter((row) => row.topic === "branding")).toEqual([
          {
            topic: "branding",
            singular: "branding revision",
            id_field: "id",
            id_arg: "id",
            verbs: ["list", "get"],
            columns: ["id", "created_at"],
            paged: false,
          },
        ]);
      });

      it("describes a topic with nothing to filter by", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--json"]);

        const { data } = app.envelopeOf<{ items: ResourceRow[] }>(result);
        expect(data.items.filter((row) => row.topic === "release")).toEqual([
          {
            topic: "release",
            singular: "release",
            id_field: "id",
            id_arg: "id",
            verbs: ["list", "get"],
            columns: [
              "id",
              "metadata.message",
              "metadata.git_sha",
              "revoked_at",
              "metadata.created_at",
            ],
            paged: true,
          },
        ]);
      });

      it("describes a topic read by its operation", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--json"]);

        const { data } = app.envelopeOf<{ items: ResourceRow[] }>(result);
        expect(data.items.filter((row) => row.topic === "policies")).toEqual([
          {
            topic: "policies",
            singular: "policy",
            id_field: "id",
            id_arg: "policy",
            verbs: ["list", "get"],
            columns: ["id", "operation", "revision_id", "updated_at"],
            paged: true,
            filters: [{ field: "operation", operations: ["equals"] }],
          },
        ]);
      });

      it("says what can be done to each topic", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--json"]);

        const { data } = app.envelopeOf<{ items: ResourceRow[] }>(result);
        for (const row of data.items) {
          expect(row.verbs ?? [], `${row.topic} lists no verbs`).not.toEqual([]);
        }
      });

      describe("without --force when no one can be asked", () => {
        it.each(DESTRUCTIVE)("is refused for %s %s", async (topic, verb, id, message, question) => {
          const app = await aSetUpApp();

          const result = await app.run([topic, verb, id, "--json"]);

          expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: `${topic}:${verb}`,
            source: MOCK_SERVER_URL,
            code: "E_CONFIRMATION_REQUIRED",
            message: `${message} without --force in non-interactive mode`,
            hint: expect.stringMatching(
              new RegExp(
                `^Ask a person first: ${question} in project proj-[\\w-]+ on mock\\.zitadel\\.test\\? Pass --force only once they agree\\.$`,
              ),
            ),
            next_commands: [
              expectedPublicCliCommand(app.againAsRun(`${topic} ${verb} ${id} --force`)),
            ],
            details: {
              question: expect.stringMatching(
                new RegExp(`^${question} in project proj-[\\w-]+ on mock\\.zitadel\\.test\\?$`),
              ),
            },
          });
        });

        it.each(SERVERS)(
          "names the project and the server it would act on, for %s",
          async (_kind, server) => {
            const app = await aSetUpApp();

            const result = await app.runWithoutServer([
              "teams",
              "deactivate",
              "team_1",
              "--server",
              server,
              "--json",
            ]);

            expect(result).toHintAt(await app.projectPlace(server));
          },
        );

        it.each(DESTRUCTIVE)(
          "suggests running %s %s again with --force",
          async (topic, verb, id) => {
            const app = await aSetUpApp();

            const result = await app.run([topic, verb, id, "--json"]);

            expect(result).toSuggestExactly(app.againAsRun(`${topic} ${verb} ${id} --force`));
          },
        );
      });

      it("registers a connection made from its nested fields", async () => {
        const app = await aSetUpApp();

        await app.run(["idps", "create", ...ACME_CONNECTION_FLAGS, "--json"]);

        expect((await app.registeredIdps()).map((idp) => idp.slug)).toContain("acme-sso");
      });

      it("answers a created connection with the secret as the reference it was given", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["idps", "create", ...ACME_CONNECTION_FLAGS, "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "idps:create",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            id: expect.stringMatching(/^idp_/),
            revision_id: expect.stringMatching(/^idprev_/),
            slug: "acme-sso",
            created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
            updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
            definition: {
              slug: "acme-sso",
              protocol: "oidc",
              display_name: "Acme SSO",
              oidc: {
                issuer: "https://sso.acme.example",
                id_token_mapping: false,
                client_id: "abc123",
                client_secret: "${{ ACME_SSO_CLIENT_SECRET }}",
                token_endpoint_auth_method: "client_secret_basic",
                scopes: ["openid"],
                pkce_enabled: true,
              },
            },
            next_commands: [
              expectedPublicCliCommand(
                `idps get ${(await app.registeredIdps())[0]?.id} --json --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("never prints the project secret", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["idps", "create", ...ACME_CONNECTION_FLAGS, "--json"]);

        const { ZITADEL_PROJECT_SECRET } = await app.developmentValues();
        expect(result.stdout + result.stderr).not.toContain(ZITADEL_PROJECT_SECRET);
      });

      it("reads a policy by its operation", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        expect(await app.publish()).toSucceed();

        const result = await app.run(["policies", "get", PASSWORD_POLICY, "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "policies:get",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            id: expect.stringMatching(/^pol_/),
            revision_id: expect.stringMatching(/^polrev_/),
            project_id: expect.stringMatching(/^proj-/),
            operation: PASSWORD_POLICY,
            config: { min_length: 12 },
            created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
            updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
          },
          warnings: [],
        });
      });
    });

    describe("a paged list", () => {
      it("keeps an escape sequence the server put in the page cursor as it came", async () => {
        const app = await aSetUpApp();
        const cursor = platform.pagesWithAHostileCursor();

        const result = await app.run(["users", "list", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "users:list",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            items: [{ id: "usr_1", attributes: {} }],
            count: 1,
            next_page_token: cursor,
            next_commands: [
              expectedPublicCliCommand(
                `users list --page-token $'cur-\\x1b[2Jwiped' --json --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("keeps the typed flags when suggesting the next page", async () => {
        const app = await aSetUpApp();
        platform.pagesWithAHostileCursor();

        const result = await app.run(["users", "list", "--limit", "1", "--fields", "id", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "users:list",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            items: [{ id: "usr_1", attributes: {} }],
            count: 1,
            next_page_token: "cur-\u001b[2Jwiped",
            next_commands: [
              expectedPublicCliCommand(
                `users list --limit 1 --fields id --page-token $'cur-\\x1b[2Jwiped' --json --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      // The cursor is the server's text, and a list names it twice for a
      // person: in its footer and in the command that reads the next page.
      // The envelope keeps it as it came, so paging with it still works.
      it("spells out an escape sequence the server put in the page cursor", async () => {
        const app = await aSetUpApp();
        platform.pagesWithAHostileCursor();

        const result = await app.run(["users", "list"]);

        expect(result.stdout + result.stderr).not.toContain("\u001b[2J");
        expect(result.stdout + result.stderr).toContain("\\x1b[2Jwiped");
      });

      it("suggests the next page once", async () => {
        const app = await aSetUpApp();
        platform.pagesWithAHostileCursor();

        const result = await app.run(["users", "list"]);

        expect(result).toSayOnce("users list --page-token");
      });
    });

    describe("a resource id of the wrong kind", () => {
      it.each(WRONG_KIND)("is refused by %j", async ({ args, list, message }) => {
        const app = await aSetUpApp();

        const result = await app.run([...args, "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: `${args[0]}:${args[1]}`,
          source: "",
          code: "E_VALIDATION",
          message,
          hint: `Find one with ${expectedPublicCliCommand(list)}.`,
          next_commands: [expectedPublicCliCommand(list)],
          details: { argument: "id" },
        });
      });
    });

    describe("--plain", () => {
      it("prints each topic as a tab-separated record", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--plain"]);

        expect(result).toPrintPlainRow("users", /.+/, /.*/);
      });

      it("prints a topic with nothing to filter by with an empty last cell", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--plain"]);

        expect(result).toPrintPlainRow("branding", "list, get", "");
      });
    });
  });
});
