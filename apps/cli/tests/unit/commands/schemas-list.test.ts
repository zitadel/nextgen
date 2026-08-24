import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";

import {
  resetPlatformStore,
  setupPlatformHandlers,
} from "@zitadel/api-mock/platform";
import { createZitadelClient } from "@zitadel/api/client";

import { fetchSchemaRevision } from "../../../src/commands/schemas/list";
import { parseJson, runCliForTest } from "../../helpers/run-cli";

const server = setupServer(...setupPlatformHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers(...setupPlatformHandlers());
  resetPlatformStore();
});

async function makeProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-schemas-list-"));
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify({
      project_id: "proj_test",
      project_secret: "sk_proj_test_full",
      preview_secret: "sk_proj_test_preview",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00Z",
    }),
  );
  return cwd;
}

describe("schemas list", () => {
  it("returns an empty payload with a helpful message when no revisions exist", async () => {
    const cwd = await makeProject();
    server.use(
      http.get("*/schemas", () => HttpResponse.json({ schemas: [] })),
    );

    const res = await runCliForTest([
      "schemas",
      "list",
      "--cwd",
      cwd,
      "--object-type",
      "human-user",
      "--json",
      "--server",
      "https://api.zitadel.cloud",
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { object_type: string; revisions: unknown[]; count: number };
    };
    expect(json.status).toBe("ok");
    expect(json.data).toEqual({
      object_type: "human-user",
      revisions: [],
      count: 0,
    });
  });

  it("returns the revision list (newest first) in non-interactive mode", async () => {
    const cwd = await makeProject();
    server.use(
      http.get("*/schemas", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("project_id")).toBe("proj_test");
        expect(url.searchParams.get("object_type")).toBe("human-user");
        return HttpResponse.json({
          schemas: [
            {
              id: "sch_02",
              schema: { kind: "user-schema" },
              metadata: { created_at: "2026-07-02T00:00:00Z" },
            },
            {
              id: "sch_01",
              schema: { kind: "user-schema" },
              metadata: { created_at: "2026-06-01T00:00:00Z" },
            },
          ],
        });
      }),
    );

    const res = await runCliForTest([
      "schemas",
      "list",
      "--cwd",
      cwd,
      "--object-type",
      "human-user",
      "--json",
      "--server",
      "https://api.zitadel.cloud",
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: {
        object_type: string;
        revisions: Array<{ id: string; created_at: string }>;
        count: number;
      };
    };
    expect(json.status).toBe("ok");
    expect(json.data.count).toBe(2);
    // Rows stay the flat `{id, created_at}` stdout contract even though the
    // wire response nests the timestamp in `metadata` and carries the full
    // document.
    expect(json.data.revisions).toEqual([
      { id: "sch_02", created_at: "2026-07-02T00:00:00Z" },
      { id: "sch_01", created_at: "2026-06-01T00:00:00Z" },
    ]);
  });

  it("URL-encodes URL-shaped schema ids when fetching a revision", async () => {
    // Server-seeded default schemas carry a URL `$id`; unencoded it would
    // shear the `/schemas/:id` path apart at every slash.
    const urlId = "https://api.zitadel.cloud/default-human-user.json";
    let receivedPath: string | null = null;
    server.use(
      http.get("*/schemas/:id", ({ request }) => {
        receivedPath = new URL(request.url).pathname;
        return HttpResponse.json({
          id: urlId,
          schema: { kind: "user-schema" },
          metadata: { created_at: "2026-06-01T00:00:00Z" },
        });
      }),
    );
    const client = createZitadelClient({ baseUrl: "https://api.zitadel.cloud" });

    const body = await fetchSchemaRevision(client, urlId);

    expect(receivedPath).toBe(`/schemas/${encodeURIComponent(urlId)}`);
    // The revision body is the customer document unwrapped from the envelope.
    expect(body).toEqual({ kind: "user-schema" });
  });
});
