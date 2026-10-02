import { resetPlatformStore, setupPlatformHandlers } from "@zitadel/api-mock/platform";
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

  /** Drops any arranged failure, so the platform answers normally again. */
  recovers(): void;

  /** Records every published branding revision, which the mock does not keep. */
  capturesBrandingPublishes(): Captured<Record<string, unknown>>;
}

/** Starts the mock platform for a spec file and resets it between tests. */
export function usePlatformMock(): PlatformMock {
  const server = setupServer(...setupPlatformHandlers());

  beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
  afterAll(() => server.close());
  afterEach(() => {
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

    recovers() {
      server.resetHandlers();
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
