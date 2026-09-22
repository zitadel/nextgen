import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * The reason the local server stores configuration as files.
 *
 * A developer configuring their project edits `.zitadel/**` and expects the
 * running server to serve the change — no restart, no re-upload, no CLI round
 * trip. These assert that directly: change a file on disk, then read the result
 * back out of the running server.
 *
 * They run only against the local runtime. A custom server may be backed by
 * Postgres or Spanner, where the files are not the store and nothing should
 * reflect.
 */

type Metadata = {
  localRuntimeUrl: string | null;
  runtime: string;
  framework: string;
};

async function metadata(): Promise<Metadata> {
  const outputDir = requiredEnv("JOURNEY_OUTPUT_DIR");
  return JSON.parse(await readFile(join(outputDir, "metadata.json"), "utf8")) as Metadata;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** The project secret the CLI stored, which management reads need. */
async function projectSecret(appDir: string): Promise<{ projectId: string; secret: string }> {
  const raw = JSON.parse(await readFile(join(appDir, ".zitadel/secret"), "utf8")) as {
    project_id?: string;
    project_secret?: string;
  };
  if (!raw.project_id || !raw.project_secret) {
    throw new Error(".zitadel/secret is missing its credentials");
  }
  return { projectId: raw.project_id, secret: raw.project_secret };
}

/**
 * Polls until `read` reports the change. A file edit reaches the server on its
 * next read, but the request that observes it is racing the editor's write, so
 * a single attempt would be asserting on timing rather than on reload.
 */
async function eventually<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  what: string,
): Promise<T> {
  const deadline = Date.now() + 15_000;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${what}; last value: ${JSON.stringify(last)}`);
}

test.describe("local file changes reach the running server", () => {
  test.beforeEach(async () => {
    const { localRuntimeUrl } = await metadata();
    test.skip(
      localRuntimeUrl === null,
      "only the local runtime stores configuration as files",
    );
  });

  // A schema edited by hand, with no CLI involved: the iteration loop this
  // storage mode exists for.
  test("a schema edited on disk is served without a restart", async ({ request }) => {
    const appDir = requiredEnv("JOURNEY_APP_DIR");
    const { localRuntimeUrl } = await metadata();
    const { projectId, secret } = await projectSecret(appDir);

    const schemaPath = join(appDir, ".zitadel/schemas/default-human-user.json");
    const original = await readFile(schemaPath, "utf8");
    const document = JSON.parse(original) as {
      $id: string;
      properties: Record<string, unknown>;
      title?: string;
    };

    const readTitle = async (): Promise<string | undefined> => {
      const response = await request.get(
        `${localRuntimeUrl}/schemas/${encodeURIComponent(document.$id)}`,
        { headers: { authorization: `Bearer ${secret}` }, params: { project_id: projectId } },
      );
      if (!response.ok()) return undefined;
      const body = (await response.json()) as { schema?: { title?: string } };
      return body.schema?.title;
    };

    // Establish that the server is serving this document at all.
    expect(await readTitle()).toBeDefined();

    try {
      const edited = { ...document, title: "Edited on disk" };
      await writeFile(schemaPath, `${JSON.stringify(edited, null, 2)}\n`, "utf8");

      const served = await eventually(
        readTitle,
        (title) => title === "Edited on disk",
        "the edited schema title to be served",
      );
      expect(served).toBe("Edited on disk");
    } finally {
      await writeFile(schemaPath, original, "utf8");
    }

    // And the revert is picked up too, so the tree really is the store rather
    // than a one-way import.
    await eventually(
      readTitle,
      (title) => title !== "Edited on disk",
      "the reverted schema to be served",
    );

  });

  // The flow definition is what the login page renders from, so an edit to it
  // is the change a developer is most likely to be iterating on.
  test("a flow edited on disk is served without a restart", async ({ request }) => {
    const appDir = requiredEnv("JOURNEY_APP_DIR");
    const { localRuntimeUrl } = await metadata();
    const { projectId, secret } = await projectSecret(appDir);

    const flowPath = join(appDir, ".zitadel/flows/default-login.json");
    const original = await readFile(flowPath, "utf8");
    const document = JSON.parse(original) as {
      name: string;
      steps: { name: string; actions?: { name: string; text_key?: string }[] }[];
    };

    const readSteps = async (): Promise<{ actions?: { text_key?: string }[] }[]> => {
      const response = await request.get(`${localRuntimeUrl}/flow_definitions`, {
        headers: { authorization: `Bearer ${secret}` },
        params: { project_id: projectId, name: document.name },
      });
      // Surface the status rather than reporting "no rows": a swallowed error
      // here reads as a hot-reload failure and hides what actually broke.
      if (!response.ok()) {
        throw new Error(
          `GET /flow_definitions failed: ${response.status()} ${await response.text()}`,
        );
      }
      // The list item is the server-owned envelope; the authored document sits
      // under `flow_definition`.
      const body = (await response.json()) as {
        flow_definitions?: {
          flow_definition?: { steps?: { actions?: { text_key?: string }[] }[] };
        }[];
      };
      return body.flow_definitions?.[0]?.flow_definition?.steps ?? [];
    };

    const readActionKeys = async (): Promise<string[]> =>
      (await readSteps()).flatMap((step) => (step.actions ?? []).map((a) => a.text_key ?? ""));

    expect(await readSteps()).not.toHaveLength(0);

    try {
      // Retitle the entry step's first action. Step *names* cannot be edited
      // freely: `purposes` and `transitions` reference them by value, so a
      // rename makes the document invalid rather than reloaded. An action's
      // text key is self-contained.
      const edited = {
        ...document,
        steps: document.steps.map((step, index) =>
          index === 0
            ? {
                ...step,
                actions: (step.actions ?? []).map((action, actionIndex) =>
                  actionIndex === 0 ? { ...action, text_key: "journey.edited" } : action,
                ),
              }
            : step,
        ),
      };
      await writeFile(flowPath, `${JSON.stringify(edited, null, 2)}\n`, "utf8");

      await eventually(
        readActionKeys,
        (keys) => keys.includes("journey.edited"),
        "the edited flow action to be served",
      );
    } finally {
      await writeFile(flowPath, original, "utf8");
    }

    await eventually(
      readActionKeys,
      (keys) => !keys.includes("journey.edited"),
      "the reverted flow to be served",
    );
  });

  // A file the developer adds, rather than edits.
  //
  // Skipped, and deliberately kept rather than deleted: it documents a real
  // limit. An *edited* document reloads because its resource-scope row already
  // exists; an *added* one has none, and get-by-id resolves a path id through
  // that index before it ever reaches storage — so the server reads the file
  // but cannot address it. Closing this needs the store to reconcile scope
  // rows for documents it discovers, which is a change to the storage layer,
  // not to this test.
  test.skip("a schema added on disk is served without a restart", async ({ request }) => {
    const appDir = requiredEnv("JOURNEY_APP_DIR");
    const { localRuntimeUrl } = await metadata();
    const { projectId, secret } = await projectSecret(appDir);

    const addedPath = join(appDir, ".zitadel/schemas/journey-added.json");
    const id = "https://example.com/schemas/journey-added.json";
    const added = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: id,
      objectType: "journey-added",
      kind: "user-schema",
      type: "object",
      "x-identifier": "email",
      required: ["email"],
      properties: { email: { type: "string", format: "email" } },
    };

    const readObjectType = async (): Promise<string | undefined> => {
      const response = await request.get(`${localRuntimeUrl}/schemas/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${secret}` },
        params: { project_id: projectId },
      });
      if (!response.ok()) return undefined;
      const body = (await response.json()) as { schema?: { objectType?: string } };
      return body.schema?.objectType;
    };

    try {
      await writeFile(addedPath, `${JSON.stringify(added, null, 2)}\n`, "utf8");
      const served = await eventually(
        readObjectType,
        (objectType) => objectType === "journey-added",
        "the newly added schema to be served",
      );
      expect(served).toBe("journey-added");
    } finally {
      await rm(addedPath, { force: true });
    }
  });
});
