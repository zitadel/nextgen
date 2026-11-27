import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import {
  anApp,
  aSetUpApp,
  MOCK_SERVER_URL,
  PASSWORD_POLICY,
  type ScaffoldedApp,
} from "@tests/helpers/project";
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
  ["user", "delete", "user_1", "Cannot delete user user_1", "Delete user user_1"],
  ["team", "deactivate", "team_1", "Cannot deactivate team team_1", "Deactivate team team_1"],
  ["session", "revoke", "sess_1", "Cannot revoke session sess_1", "Revoke session sess_1"],
];

const WRONG_KIND: readonly { args: string[]; list: string; message: string }[] = [
  {
    args: ["user", "get", "rel_01M6KPFXAE68N6G2X1HN5XD29R"],
    list: "user list",
    message: "Invalid id: must be a user ID: user_ followed by letters, digits, _ or -",
  },
  {
    args: ["session", "get", "user_01KX5N7C9D2E7F0N9WD3P2E4YM6"],
    list: "session list",
    message: "Invalid id: must be a session ID: sess_ followed by letters, digits, _ or -",
  },
  {
    args: ["release", "get", "sess_01KX5N7C9D2E7F0N9WD3P2E4YM6"],
    list: "release list",
    message: "Invalid id: must be a release ID: rel_ followed by letters, digits, _ or -",
  },
];

/** Create a resource with the CLI's own create command and return its id. */
async function aCreated(app: ScaffoldedApp, args: readonly string[]): Promise<string> {
  const result = await app.run([...args, "--non-interactive", "--json"]);
  expect(result, "arranging the resource should have succeeded").toSucceed();
  return app.envelopeOf<{ id: string }>(result).data.id;
}

/** Create a team and return its id. */
async function aTeam(app: ScaffoldedApp): Promise<string> {
  return aCreated(app, ["team", "create", "--name", "Support"]);
}

/** Create a user on the project's published schema and return its id. */
async function aUser(app: ScaffoldedApp): Promise<string> {
  const { id } = await app.publishedSchema();
  return aCreated(app, ["user", "create", "--schema", id, "--attributes", "email=ada@example.com"]);
}

/** Grant a new team the viewer role on the project and return the grant's id. */
async function aGrant(app: ScaffoldedApp): Promise<string> {
  const teamId = await aTeam(app);
  return aCreated(app, ["grant", "create", "--relation", "viewer", "--team-team-id", teamId]);
}

/** Read a resource back with its get or list command, as the envelope's data. */
async function readBack(app: ScaffoldedApp, args: readonly string[]): Promise<unknown> {
  const result = await app.run([...args, "--non-interactive", "--json"]);
  expect(result, "reading the resource back should have succeeded").toSucceed();
  return app.envelopeOf(result).data;
}

const READ_BACK: readonly [
  string,
  string,
  (app: ScaffoldedApp) => Promise<string>,
  (id: string) => string[],
][] = [
  ["user", "delete", aUser, (id) => ["user", "get", id]],
  ["team", "deactivate", aTeam, (id) => ["team", "get", id]],
  ["grant", "delete", aGrant, () => ["grant", "list"]],
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
          data: {
            title: "Found 12 resources",
            items: expect.any(Array),
            count: expect.any(Number),
            truncated: false,
            next_page_token: null,
          },
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
          data: {
            title: "Found 12 resources",
            items: expect.any(Array),
            count: expect.any(Number),
            truncated: false,
            next_page_token: null,
          },
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
          data: {
            title: "Found 12 resources",
            items: expect.any(Array),
            count: expect.any(Number),
            truncated: false,
            next_page_token: null,
          },
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

        const result = await app.run(["idp", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "idp:list",
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

        const result = app.run(["idp", "list", "--json"]);
        await waiting;
        pressCtrlC();

        expect(await result).toFailWith("E_CANCELLED");
        expect(app.envelopeOf(await result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "idp:list",
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
      it("cuts each record to the fields named", async () => {
        const app = await anApp();

        const result = await app.run(["resources", "--fields", "topic", "--json"]);

        const { items } = app.envelopeOf<{ items: object[] }>(result).data;

        expect(new Set(items.flatMap((item) => Object.keys(item)))).toEqual(new Set(["topic"]));
      });

      it("refuses a field the records do not carry", async () => {
        const app = await anApp();

        const result = await app.run(["resources", "--fields", "nope", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("lists what the CLI manages before the project is set up", async () => {
        const app = await anApp();

        const result = await app.run(["resources", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "resources",
          source: "",
          status: "ok",
          data: {
            title: "Found 12 resources",
            items: expect.any(Array),
            count: expect.any(Number),
            truncated: false,
            next_page_token: null,
          },
          warnings: [],
        });
      });

      it("names every topic the resource commands are generated for", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--json"]);

        const { data } = app.envelopeOf<{ items: ResourceRow[] }>(result);
        expect(data.items.map((row) => row.topic)).toEqual(
          expect.arrayContaining(["user", "team", "session", "idp", "schema"]),
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
            paged: true,
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
        expect(data.items.filter((row) => row.topic === "policy")).toEqual([
          {
            topic: "policy",
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
              "team",
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

      describe("leaving what it would change as it was", () => {
        it.each(READ_BACK)("refuses %s %s without --force", async (topic, verb, arrange) => {
          const app = await aSetUpApp();
          const id = await arrange(app);

          expect(await app.run([topic, verb, id, "--non-interactive", "--json"])).toFailWith(
            "E_CONFIRMATION_REQUIRED",
          );
        });

        it.each(READ_BACK)(
          "changes nothing on %s %s without --force",
          async (topic, verb, arrange, read) => {
            const app = await aSetUpApp();
            const id = await arrange(app);
            const before = await readBack(app, read(id));

            await app.run([topic, verb, id, "--non-interactive", "--json"]);

            expect(await readBack(app, read(id))).toEqual(before);
          },
        );
      });

      describe("with --force", () => {
        it("leaves a deleted user unreadable", async () => {
          const app = await aSetUpApp();
          const id = await aUser(app);

          await app.run(["user", "delete", id, "--force", "--json"]);

          expect(await app.run(["user", "get", id, "--json"])).toFailWith("E_NOT_FOUND");
        });

        it("leaves a deactivated team readable, as deactivated", async () => {
          const app = await aSetUpApp();
          const id = await aTeam(app);

          await app.run(["team", "deactivate", id, "--force", "--json"]);

          expect(await readBack(app, ["team", "get", id])).toEqual({
            title: "Read Support",
            id,
            name: "Support",
            status: "deactivated",
            created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
            updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          });
        });

        it("leaves a deleted grant out of the list", async () => {
          const app = await aSetUpApp();
          const id = await aGrant(app);

          await app.run(["grant", "delete", id, "--force", "--json"]);

          expect(await readBack(app, ["grant", "list"])).toEqual({
            title: "No grants found",
            items: [],
            count: 0,
            truncated: false,
            next_page_token: null,
          });
        });
      });

      it("registers a connection made from its nested fields", async () => {
        const app = await aSetUpApp();

        await app.run(["idp", "create", ...ACME_CONNECTION_FLAGS, "--json"]);

        expect((await app.registeredIdps()).map((idp) => idp.slug)).toContain("acme-sso");
      });

      it("answers a created connection with the secret as the reference it was given", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["idp", "create", ...ACME_CONNECTION_FLAGS, "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "idp:create",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: expect.stringMatching(/^Created identity provider connection idp_/),
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
                `idp get ${(await app.registeredIdps())[0]?.id} --json --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("never prints the project secret", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["idp", "create", ...ACME_CONNECTION_FLAGS, "--json"]);

        const { ZITADEL_PROJECT_SECRET } = await app.developmentValues();
        expect(result.stdout + result.stderr).not.toContain(ZITADEL_PROJECT_SECRET);
      });

      it("reads a policy by its operation", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        expect(await app.publish()).toSucceed();

        const result = await app.run(["policy", "get", PASSWORD_POLICY, "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "policy:get",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: "Read auth.factor.password.set",
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

        const result = await app.run(["user", "list", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "user:list",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: "Found 1 user",
            items: [{ id: "usr_1", attributes: {} }],
            count: 1,
            truncated: true,
            next_page_token: cursor,
            next_commands: [
              expectedPublicCliCommand(
                `user list --page-token $'cur-\\x1b[2Jwiped' --json --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("keeps the typed flags when suggesting the next page", async () => {
        const app = await aSetUpApp();
        platform.pagesWithAHostileCursor();

        const result = await app.run(["user", "list", "--limit", "1", "--fields", "id", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "user:list",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: "Found 1 user",
            items: [{ id: "usr_1" }],
            count: 1,
            truncated: true,
            next_page_token: "cur-\u001b[2Jwiped",
            next_commands: [
              expectedPublicCliCommand(
                `user list --limit 1 --fields id --page-token $'cur-\\x1b[2Jwiped' --json --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
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

        const result = await app.run(["user", "list"]);

        expect(result.stdout + result.stderr).not.toContain("\u001b[2J");
        expect(result.stdout + result.stderr).toContain("\\x1b[2Jwiped");
      });

      it("suggests the next page once", async () => {
        const app = await aSetUpApp();
        platform.pagesWithAHostileCursor();

        const result = await app.run(["user", "list"]);

        expect(result).toSayOnce("user list --page-token");
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
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message,
          hint: "List them to find one.",
          next_commands: [
            expectedPublicCliCommand(`${list} --server ${MOCK_SERVER_URL} --cwd ${app.path}`),
          ],
          details: { argument: "id" },
        });
      });
    });

    describe("--plain", () => {
      it("prints each topic as a tab-separated record", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--plain"]);

        expect(result).toPrintPlainRow("user", /.+/, /.*/);
      });

      it("prints a topic with nothing to filter by with an empty last cell", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["resources", "--plain"]);

        expect(result).toPrintPlainRow("branding", "list, get", "");
      });
    });
  });
});
