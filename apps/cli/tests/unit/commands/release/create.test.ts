import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { makeProject } from "../../../helpers/local-project";
import { runCliForTest, stripAnsi } from "../../../helpers/run-cli";
import { asTerminal } from "../../../helpers/terminal";

const SERVER = "https://api.zitadel.cloud";
const HASH = `sha256:${"d9b331a42e4e2d770718644ee48b679d9ffa7c3821f84d6e6ca849d4e2377691"}`;
const server = setupServer();

/** A user-schema the server would accept, so the bundle validates. */
const SCHEMA = {
  objectType: "human-user",
  kind: "user-schema",
  metaSchema: "https://example.com/meta/user-schema.json",
  "x-auth-methods": { password: { enabled: true } },
  "x-identifier": "email",
  properties: { email: { "x-unique": "project" } },
};

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const created = async (): Promise<string> => {
  const cwd = await makeProject({ linked: true, schemas: { "human-user": SCHEMA } });
  server.use(
    http.post(`${SERVER}/releases/build`, () =>
      HttpResponse.json({
        id: "rel_1",
        project_id: "proj_01TEST",
        content_hash: HASH,
        revoked_at: null,
        metadata: {},
      }),
    ),
  );
  const res = await asTerminal(() =>
    runCliForTest(["release", "create", "--cwd", cwd, "--server", SERVER, "--no-telemetry"]),
  );
  expect(res.exitCode).toBe(0);
  return stripAnsi(res.stdout);
};

describe("release create", () => {
  it("keeps what it did in the footer, rather than losing it to a long headline", async () => {
    const out = await created();

    // A clause wider than the footer allows is replaced by "Done", which left
    // this command's footer with its place half and nothing else.
    expect(out).toContain("Created rel_1 · project proj_01TEST");
    expect(out).not.toMatch(/^\s*project proj_01TEST on/m);
  });

  it("leaves the content digest to --json and release get", async () => {
    const out = await created();

    expect(out).not.toContain(HASH);
  });
});
