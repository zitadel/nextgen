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

/** What the platform was asked to publish, for a surface the mock does not keep. */
/** The object type of the schema the scaffolded login flow serves, read from the scaffold's own default. */
const SERVED_OBJECT_TYPE = String(getDefaultHumanUserSchema().objectType);

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
  /** Makes storing a schema fail, so a command fails partway through. */
  rejectsSchemaUploads(): void;

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
}

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
        const body: unknown = await request.json();
        // Held to the API's own request schema, as the real server holds it, so a
        // filter shape the API would refuse fails the spec instead of passing.
        if (!QueryUsersBody.safeParse(body).success) {
          return HttpResponse.json(
            { code: "req.invalid", message: "the request is invalid" },
            { status: 400 },
          );
        }
        const { filter = [] } = body as {
          filter?: Array<{ field: string; operation: string; value: string }>;
        };
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

    rejectsSchemaUploads() {
      server.use(
        http.post("*/schemas", () =>
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
      const published: Array<Record<string, unknown>> = [];
      server.use(
        http.post("*/branding", async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
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
      const requests: Array<Record<string, unknown>> = [];
      server.use(
        http.post("*/deployments/:id/rollback", async ({ request }) => {
          const text = await request.clone().text();
          requests.push(text === "" ? {} : (JSON.parse(text) as Record<string, unknown>));
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
  };
}
