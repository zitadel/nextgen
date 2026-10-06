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

  /** Drops any arranged failure, so the platform answers normally again. */
  recovers(): void;

  /**
   * Completes the claim challenge as soon as `claim` opens one, standing in
   * for the person who would finish it in a browser.
   */
  completesTheNextClaim(): void;

  /** Records every published branding revision, which the mock does not keep. */
  capturesBrandingPublishes(): Captured<Record<string, unknown>>;
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

  return {
    rejectsSchemaUploads() {
      server.use(
        http.post("*/schemas", () =>
          HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
        ),
      );
    },

    isNotZitadel() {
      server.use(http.all("*", () => HttpResponse.text("<html>not here</html>", { status: 404 })));
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
  };
}
