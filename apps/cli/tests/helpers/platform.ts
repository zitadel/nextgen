import {
  completeClaimChallenge,
  resetPlatformStore,
  setupPlatformHandlers,
  snapshotPlatformStore,
} from "@zitadel/api-mock/platform";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

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
  /** Makes storing a schema fail, so a command fails partway through. */
  rejectsSchemaUploads(): void;

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

  /**
   * Refuses every read of a variable, as a credential without `variable.read`
   * does, while a deployment and the project still answer. A command that reads
   * a deployment must not need that permission to do it.
   */
  refusesVariableReads(): void;

  /**
   * Answers the next project creation with an id holding a terminal escape
   * sequence, as a compromised server would. Whatever prints it must spell it
   * out rather than let it drive the reader's terminal.
   *
   * @returns The id it will answer with.
   */
  mintsAHostileProjectId(): string;

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

    mintsAHostileProjectId() {
      const id = "proj-\u001b[2Jwiped";
      server.use(
        http.post("*/projects", async ({ request }) => {
          const body = (await request.json()) as { name?: string };
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
