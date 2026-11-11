import {
  completeClaimChallenge,
  resetPlatformStore,
  setupPlatformHandlers,
  snapshotPlatformStore,
} from "@zitadel/api-mock/platform";
import { QueryUsersBody } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { getDefaultHumanUserSchema } from "@zitadel/config/defaults";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import { z } from "zod";

import type { JsonObject } from "@/lib/zitadel/types";
import { toJsonObject } from "@/lib/zitadel/utils/json";

/** The object type of the schema the scaffolded login flow serves, read from the scaffold's own default. */
const SERVED_OBJECT_TYPE = String(getDefaultHumanUserSchema().objectType);

/** The part of a request to store an origin these handlers read: its kind. */
const OriginRequest = z.object({
  kind: z.string().optional(),
});

/** The part of a request to create a project these handlers read: its name. */
const ProjectRequest = z.object({
  name: z.string().optional(),
});

/** What the platform was asked to publish, for a surface the mock does not keep. */
export interface Captured<T> {
  readonly all: T[];
  readonly count: number;
  readonly last: T | undefined;
}

/**
 * The mock platform for one spec file, with the arrangements a spec is allowed
 * to make of it. A spec says what the platform should do in its own terms; the
 * HTTP it takes to arrange that stays in here.
 */
export interface PlatformMock {
  /** Holds a user of the login flow's schema that carries no email, the identifier the scaffold signs in with. */
  holdsAUserWithoutAnEmail(): void;

  /** Holds a deactivated user of the login flow's schema that carries no email. */
  holdsADeactivatedUserWithoutAnEmail(): void;

  /** Holds a user of the login flow's schema that carries an email. */
  holdsAUserWithAnEmail(): void;

  /** Holds a user with a linked sign-in provider on a schema no flow serves. */
  holdsASsoUserOnAnotherSchema(): void;

  /** Holds a user on a schema no flow serves whose provider links cannot be read. */
  holdsAUserWhoseLinksCannotBeRead(): void;

  /** Makes the project's users unreadable while everything else answers. */
  cannotQueryUsers(): void;

  /**
   * Refuses every release build as a server does a bundle whose schema names a
   * property it does not have: `rel.invalid`, with the reason under
   * `details.resources`.
   */
  rejectsASchema(): void;

  /**
   * Refuses every release build as a server does a bundle whose flow fails
   * against its schema: `rel.invalid`, with the reason under the resource's
   * own `details`.
   */
  rejectsAFlow(): void;

  /**
   * Refuses every release build as a server does a bundle whose connection
   * changes a field fixed for the life of the connection: `rel.invalid`, with
   * the field named in the resource's own `details`.
   */
  rejectsAConnection(): void;

  /**
   * Answers as a server that is reachable but is not a Zitadel platform API,
   * which is what a mistyped or wrong `--server` points at: every route 404s
   * with a body that is not a platform error envelope.
   */
  isNotZitadel(): void;

  /**
   * Makes every request fail as a platform that is down would: it answers,
   * but with a 503. The CLI maps that to `E_NETWORK`.
   */
  isUnavailable(): void;

  /** Refuses every project read with 403, as a server does a token without that grant. */
  refusesProjectReads(): void;

  /**
   * Makes every request fail before any response arrives, as a closed port or
   * an unresolvable host would. The CLI maps that to `E_NETWORK` too.
   */
  refusesConnections(): void;

  /**
   * Accepts every request and never answers, as a wedged server or a proxy
   * holding the connection open would; a request settles only when aborted.
   * Resolves once the first request is being held, so a spec can act while
   * the command is waiting.
   */
  hangs(): Promise<void>;

  /** Makes the project's variables unreadable while everything else answers. */
  cannotListVariables(): void;

  /**
   * Refuses every read of a variable, as a credential without `variable.read`
   * does, while a deployment and the project still answer. A command that reads
   * a deployment must not need that permission to do it.
   */
  refusesVariableReads(): void;

  /**
   * Answers the next origin it is given with `pattern`, whatever was asked for,
   * as a server that stored something else would. The pattern is the server's
   * text, so whatever prints it has to spell out what could drive a terminal.
   *
   * @param pattern - The pattern to answer with.
   */
  storesOrigin(pattern: string): void;

  /**
   * Answers the next project creation with an id holding a terminal escape
   * sequence, as a compromised server would. Whatever prints it must spell it
   * out rather than let it drive the reader's terminal.
   *
   * @returns The id it will answer with.
   */
  mintsAHostileProjectId(): string;

  /**
   * Answers every deployment read and write with an origin holding a terminal
   * escape sequence, as a compromised server would. Whatever renders it must
   * spell it out rather than let it drive the reader's terminal.
   *
   * @returns The origin it will answer with.
   */
  servesAHostileOrigin(): string;

  /**
   * Answers a project read with an origin pattern holding a terminal escape
   * sequence, which is what a command printing the project's own origins names
   * rather than a deployment's targets.
   *
   * Faithful for a caller reading the origins and nothing else: the body holds
   * those and the project's own name, not the secrets the real read also
   * answers, so a command taking its credential off this read sees none.
   *
   * @returns The pattern it will answer with.
   */
  admitsAHostileOriginPattern(): string;

  /**
   * Answers a release build with a content hash holding a terminal escape
   * sequence, before the colon that names its algorithm, which is the part a
   * shortened hash keeps whole.
   *
   * @returns The hash it will answer with.
   */
  buildsAReleaseWithAHostileHash(): string;

  /**
   * Answers a release revoke with an id holding a terminal escape sequence.
   *
   * @returns The id it will answer with.
   */
  revokesAHostileReleaseId(): string;

  /**
   * Answers a user query with a page cursor holding a terminal escape
   * sequence, which the footer and the next-page command both name.
   *
   * @returns The cursor it will answer with.
   */
  pagesWithAHostileCursor(): string;

  /**
   * Answers a project read with `401`, as a credential the server does not
   * accept at all does. A caller that carries on without a read it was not
   * permitted must not carry on without one it was not authenticated for.
   */
  rejectsTheCredential(): void;

  /** Makes a stored connection unreadable while everything else answers. */
  cannotReadConnections(): void;

  /**
   * Answers the next deployment create with `409 dep.conflict`, as when another
   * deploy lands between a deploy's inspection and its write.
   */
  racesTheNextDeploy(): void;

  /** Drops any arranged failure, so the platform answers normally again. */
  recovers(): void;

  /**
   * Completes the claim challenge as soon as `claim` opens one, standing in
   * for the person who would finish it in a browser.
   */
  completesTheNextClaim(): void;

  /** Records every published branding revision, which the mock does not keep. */
  capturesBrandingPublishes(): Captured<Record<string, unknown>>;

  /** Records every rollback request's body, then lets the platform answer it. */
  capturesRollbacks(): Captured<Record<string, unknown>>;

  /**
   * Publishes `version` as the CLI's latest on the npm registry, and on GitHub
   * the releases that carry `breaking`, a note per version.
   */
  publishesCli(version: string, breaking?: Record<string, string>): void;

  /** Takes the npm registry out of reach, as an offline machine has it. */
  npmRegistryIsDown(): void;
}

const NPM_DIST_TAGS = "https://registry.npmjs.org/-/package/:name/dist-tags";
const GITHUB_RELEASES = "https://api.github.com/repos/zitadel/nextgen/releases";

/** Starts the mock platform for a spec file and resets it between tests. */
export function usePlatformMock(): PlatformMock {
  const server = setupServer(...setupPlatformHandlers());
  const watchers: NodeJS.Timeout[] = [];

  beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
  afterAll(() => server.close());
  afterEach(() => {
    for (const watcher of watchers.splice(0)) {
      clearInterval(watcher);
    }
    server.resetHandlers();
    resetPlatformStore();
  });

  const holdUsers = (matching: Record<string, unknown>[], elsewhere: Record<string, unknown>[]) => {
    server.use(
      http.post("*/users/query", async ({ request }) => {
        // Held to the API's own request schema, as the real server holds it, so a
        // filter shape the API would refuse fails the spec instead of passing.
        const query = QueryUsersBody.safeParse(await request.json());
        if (!query.success) {
          return HttpResponse.json(
            { code: "req.invalid", message: "the request is invalid" },
            { status: 400 },
          );
        }
        const { filter = [] } = query.data;
        const status = filter.find((entry) => entry.field === "status")?.value;
        const alive = (users: Record<string, unknown>[]) =>
          users.filter((user) => status === undefined || (user.status ?? "active") === status);
        const equals = filter.find(
          (entry) => entry.field === "schema_object_type" && entry.operation === "equals",
        );
        if (equals !== undefined) {
          return HttpResponse.json({
            users: equals.value === SERVED_OBJECT_TYPE ? alive(matching) : [],
          });
        }
        const excluded = filter
          .filter((entry) => entry.operation === "not_equals")
          .map((entry) => entry.value);
        return HttpResponse.json({
          users: excluded.includes(SERVED_OBJECT_TYPE) ? alive(elsewhere) : [],
        });
      }),
    );
  };

  const refuseReleases = (resources: readonly Record<string, unknown>[]) => {
    server.use(
      http.post("*/releases/build", () =>
        HttpResponse.json(
          { code: "rel.invalid", message: "release: invalid", details: { resources } },
          { status: 400 },
        ),
      ),
    );
  };

  return {
    holdsAUserWithoutAnEmail() {
      holdUsers([{ id: "user_1", schema: "sch_1", attributes: {} }], []);
    },

    holdsADeactivatedUserWithoutAnEmail() {
      holdUsers([{ id: "user_1", schema: "sch_1", status: "deactivated", attributes: {} }], []);
    },

    holdsAUserWithAnEmail() {
      holdUsers([{ id: "user_1", schema: "sch_1", attributes: { email: "ada@example.com" } }], []);
    },

    holdsASsoUserOnAnotherSchema() {
      holdUsers(
        [],
        [{ id: "user_2", schema: "https://schemas.test/employee.json", attributes: {} }],
      );
      server.use(
        http.get("*/users/:id/identity_links", () =>
          HttpResponse.json({
            identity_links: [
              { id: "link_1", connection_id: "idp_1", created_at: "2026-01-01T00:00:00Z" },
            ],
          }),
        ),
      );
    },

    holdsAUserWhoseLinksCannotBeRead() {
      holdUsers([], [{ id: "user_2", schema: "sch_2", attributes: {} }]);
      server.use(
        http.get("*/users/:id/identity_links", () =>
          HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
        ),
      );
    },

    cannotQueryUsers() {
      server.use(
        http.post("*/users/query", () =>
          HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
        ),
      );
    },

    rejectsASchema() {
      refuseReleases([
        {
          kind: "schema",
          handle: "human-user",
          code: "sch.invalid_request",
          message: 'schema designation invalid: "x-display" names unknown property "nickname"',
        },
      ]);
    },

    rejectsAFlow() {
      refuseReleases([
        {
          kind: "flow",
          handle: "default-login",
          code: "flowdef.invalid",
          message: "flow definition: invalid",
          details: {
            details: 'step "register-password": on_success create_user requires "identifier"',
          },
        },
      ]);
    },

    rejectsAConnection() {
      refuseReleases([
        {
          kind: "idp",
          handle: "google",
          code: "idp.field_immutable",
          message:
            "identity provider connection: the field is fixed for the life of the connection",
          details: { details: { fields: ["oidc.issuer"] } },
        },
      ]);
    },

    isNotZitadel() {
      server.use(http.all("*", () => HttpResponse.text("<html>not here</html>", { status: 404 })));
    },

    refusesProjectReads() {
      server.use(
        http.get("*/projects/:id", () =>
          HttpResponse.json({ code: "auth.forbidden", message: "forbidden" }, { status: 403 }),
        ),
      );
    },

    storesOrigin(pattern: string) {
      server.use(
        http.post("*/projects/:projectId/origins", async ({ request }) => {
          const body = OriginRequest.parse(await request.json());
          return HttpResponse.json(
            {
              pattern,
              kind: body.kind ?? "primary",
            },
            { status: 201 },
          );
        }),
      );
    },

    mintsAHostileProjectId() {
      const id = "proj-\u001b[2Jwiped";
      server.use(
        http.post("*/projects", async ({ request }) => {
          const body = ProjectRequest.parse(await request.json());
          return HttpResponse.json(
            {
              id,
              name: body.name ?? "hostile",
              project_secret: "sk_proj_hostile",
              preview_secret: "pk_proj_hostile",
              origins: [],
            },
            { status: 201 },
          );
        }),
      );
      return id;
    },

    servesAHostileOrigin() {
      const origin = "https://app.acme.com\u001b[2Jwiped";
      const deployment = (id: string) => {
        return {
          id,
          project_id: "proj_1",
          release_id: "rel_1",
          kind: "deploy",
          status: "live",
          deployed_at: "2026-01-01T00:00:00Z",
          metadata: { reason: "deploy" },
          targets: [{ origin }],
        };
      };
      server.use(
        http.post("*/deployments", () => {
          return HttpResponse.json(deployment("dep_hostile"), { status: 201 });
        }),
        http.get("*/deployments/:deploymentId", ({ params }) => {
          return HttpResponse.json(deployment(String(params.deploymentId)));
        }),
        // The list too, so what a resolve reads carries the origin as surely
        // as a read of one deployment does. Built from the ids the store
        // already holds, so a read of the deployment it names still answers,
        // and the newest of them because that is what the live list answers:
        // the snapshot is already sorted newest first.
        http.get("*/deployments", () => {
          return HttpResponse.json({
            deployments: snapshotPlatformStore()
              .deploymentIds.slice(0, 1)
              .map((id) => {
                return deployment(id);
              }),
            next_page_token: null,
          });
        }),
      );
      return origin;
    },

    buildsAReleaseWithAHostileHash() {
      const hash = `sha256\u001b[2Jwiped:${"a".repeat(64)}`;
      server.use(
        http.post("*/releases/build", () => {
          return HttpResponse.json({
            id: "rel_1",
            project_id: "proj_1",
            content_hash: hash,
            created_at: "2026-01-01T00:00:00Z",
            revoked_at: null,
          });
        }),
      );
      return hash;
    },

    revokesAHostileReleaseId() {
      const id = "rel-\u001b[2Jwiped";
      server.use(
        http.post("*/releases/:releaseId/revoke", () => {
          return HttpResponse.json({
            id,
            content_hash: "sha256:hostile",
            revoked_at: "2026-01-01T00:00:00Z",
          });
        }),
      );
      return id;
    },

    pagesWithAHostileCursor() {
      const cursor = "cur-\u001b[2Jwiped";
      server.use(
        http.post("*/users/query", () => {
          return HttpResponse.json({
            users: [{ id: "usr_1", attributes: {} }],
            next_page_token: cursor,
          });
        }),
      );
      return cursor;
    },

    admitsAHostileOriginPattern() {
      const pattern = "https://admitted.acme.com\u001b[2Jwiped";
      server.use(
        http.get("*/projects/:id", ({ params }) =>
          HttpResponse.json({
            id: String(params.id),
            name: "hostile",
            lifecycle: "active",
            origins: [{ pattern, kind: "primary" }],
          }),
        ),
      );
      return pattern;
    },

    rejectsTheCredential() {
      server.use(
        http.get("*/projects/:id", () =>
          HttpResponse.json(
            { code: "auth.unauthorized", message: "the credential was not accepted" },
            { status: 401 },
          ),
        ),
      );
    },

    isUnavailable() {
      server.use(
        http.all("*", () =>
          HttpResponse.json({ code: "unavailable", message: "down" }, { status: 503 }),
        ),
      );
    },

    refusesConnections() {
      server.use(http.all("*", () => HttpResponse.error()));
    },

    hangs() {
      return new Promise<void>((waiting) => {
        server.use(
          http.all("*", ({ request }) => {
            waiting();
            return new Promise<never>((_, reject) => {
              request.signal.addEventListener("abort", () => reject(request.signal.reason));
            });
          }),
        );
      });
    },

    racesTheNextDeploy() {
      server.use(
        http.post(
          "*/deployments",
          () =>
            HttpResponse.json(
              {
                code: "dep.conflict",
                message:
                  "deployment: the newest deployment to the targets does not match expected_deployment_id",
              },
              { status: 409 },
            ),
          { once: true },
        ),
      );
    },

    refusesVariableReads() {
      const refuse = () => {
        return HttpResponse.json(
          { code: "proj.permission_denied", message: "the credential may not read variables" },
          { status: 403 },
        );
      };
      server.use(
        http.get("*/deployments/:deploymentId/variables", refuse),
        http.get("*/variables", refuse),
        http.get("*/variables/:name", refuse),
      );
    },

    cannotListVariables() {
      server.use(
        http.get("*/variables", () =>
          HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
        ),
      );
    },

    cannotReadConnections() {
      server.use(
        http.get("*/idps/:id", () =>
          HttpResponse.json({ code: "unavailable", message: "down" }, { status: 503 }),
        ),
      );
    },

    recovers() {
      server.resetHandlers();
    },

    completesTheNextClaim() {
      const watcher = setInterval(() => {
        const { claimChallengeIds, projectIds } = snapshotPlatformStore();
        const challengeId = claimChallengeIds[0];
        const projectId = projectIds[0];
        if (challengeId !== undefined && projectId !== undefined) {
          clearInterval(watcher);
          completeClaimChallenge(challengeId, projectId);
        }
      }, 20);
      watchers.push(watcher);
    },

    capturesBrandingPublishes() {
      const published: JsonObject[] = [];
      server.use(
        http.post("*/branding", async ({ request }) => {
          const body = toJsonObject(await request.json(), "The branding publish");
          published.push(body);
          return HttpResponse.json(
            { id: "brandrev_setup_1", created_at: "2026-08-04T00:00:00.000Z", branding: body },
            { status: 201 },
          );
        }),
        http.get("*/branding/:id", ({ params }) =>
          HttpResponse.json({
            id: params.id,
            created_at: "2026-08-04T00:00:00.000Z",
            branding: published.at(-1) ?? {},
          }),
        ),
      );
      return {
        get all() {
          return published;
        },
        get count() {
          return published.length;
        },
        get last() {
          return published.at(-1);
        },
      };
    },

    capturesRollbacks() {
      const requests: JsonObject[] = [];
      server.use(
        http.post("*/deployments/:id/rollback", async ({ request }) => {
          const text = await request.clone().text();
          requests.push(text === "" ? {} : toJsonObject(JSON.parse(text), "The rollback request"));
          return undefined;
        }),
      );
      return {
        get all() {
          return requests;
        },
        get count() {
          return requests.length;
        },
        get last() {
          return requests.at(-1);
        },
      };
    },

    publishesCli(version, breaking = {}) {
      server.use(
        http.get(NPM_DIST_TAGS, () => HttpResponse.json({ latest: version })),
        http.get(GITHUB_RELEASES, () =>
          HttpResponse.json(
            Object.entries(breaking).map(([tag, note]) => ({
              tag_name: `v${tag}`,
              body: `**Breaking:** ${note}`,
            })),
          ),
        ),
      );
    },

    npmRegistryIsDown() {
      server.use(http.get(NPM_DIST_TAGS, () => HttpResponse.error()));
    },
  };
}
