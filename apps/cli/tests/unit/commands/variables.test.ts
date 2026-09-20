import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { HttpResponse, http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";

import { resetPlatformStore, setupPlatformHandlers } from "@zitadel/api-mock/platform";

import { parseJson, runCliForTest } from "../../helpers/run-cli";

const server = setupServer(...setupPlatformHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers(...setupPlatformHandlers());
  resetPlatformStore();
});

const SERVER = "https://api.zitadel.cloud";

async function makeProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-variables-"));
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

const base = (cwd: string) => ["--cwd", cwd, "--json", "--server", SERVER];

/**
 * Run with `value` on stdin, the way a scripted `zitadel variables set NAME <
 * value.txt` supplies it. `runCliForTest` runs in-process, so the stream is
 * swapped for the duration of the call and restored afterwards.
 */
async function withStdin<T>(value: string, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "stdin");
  Object.defineProperty(process, "stdin", {
    value: Readable.from([value]),
    configurable: true,
  });
  try {
    return await run();
  } finally {
    if (original) {
      Object.defineProperty(process, "stdin", original);
    }
  }
}

describe("variables list", () => {
  it("returns the owner's variables, withholding secret values", async () => {
    const cwd = await makeProject();
    server.use(
      http.get("*/variables", () =>
        HttpResponse.json({
          GOOGLE_CLIENT_SECRET: { secret: true },
          GOOGLE_CLIENT_ID: "999-prod",
        }),
      ),
    );

    const res = await runCliForTest(["variables", "list", "-e", "prod", ...base(cwd)]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { environment: string; count: number; variables: Array<Record<string, unknown>> };
    };
    expect(json.status).toBe("ok");
    expect(json.data.environment).toBe("prod");
    expect(json.data.count).toBe(2);
    expect(json.data.variables).toEqual([
      { name: "GOOGLE_CLIENT_ID", secret: false, value: "999-prod" },
      { name: "GOOGLE_CLIENT_SECRET", secret: true },
    ]);
  });

  it("never emits a value key for a secret", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables", () => HttpResponse.json({ S: { secret: true } })));

    const res = await runCliForTest(["variables", "list", ...base(cwd)]);

    const json = parseJson(res.stdout) as { data: { variables: Array<Record<string, unknown>> } };
    expect(Object.hasOwn(json.data.variables[0]!, "value")).toBe(false);
  });

  it("addresses the project level when no environment is given", async () => {
    const cwd = await makeProject();
    let seen: string | null = "unset";
    server.use(
      http.get("*/variables", ({ request }) => {
        seen = new URL(request.url).searchParams.get("environment_name");
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest(["variables", "list", ...base(cwd)]);

    expect(res.exitCode).toBe(0);
    expect(seen).toBeNull();
    const json = parseJson(res.stdout) as { data: { environment: null; count: number } };
    expect(json.data.environment).toBeNull();
    expect(json.data.count).toBe(0);
  });

  it("does not let the owner name pick a different server", async () => {
    const cwd = await makeProject();
    // `zitadel.json` names one server for the project and another under the
    // environment called "prod". The owner flag must not reach the server
    // resolver, or `-e prod` would silently address the second one. No
    // `--server` here: that flag short-circuits resolution and would hide it.
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({
        project: "proj_test",
        server: SERVER,
        environments: { prod: { server: "https://elsewhere.example" } },
      }),
    );
    let hit = "";
    server.use(
      http.get("*/variables", ({ request }) => {
        hit = new URL(request.url).origin;
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest(["variables", "list", "-e", "prod", "--cwd", cwd, "--json"]);

    expect(res.exitCode).toBe(0);
    expect(hit).toBe(SERVER);
  });

  it("rejects an environment name the platform's grammar refuses", async () => {
    const cwd = await makeProject();

    const res = await runCliForTest(["variables", "list", "-e", "Prod", ...base(cwd)]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { status: string; code: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
  });
});

describe("variables set", () => {
  it("sends the piped value and marks it secret", async () => {
    const cwd = await makeProject();
    let body: Record<string, unknown> = {};
    let environment: string | null = null;
    server.use(
      http.patch("*/variables", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        environment = new URL(request.url).searchParams.get("environment_name");
        return HttpResponse.json({});
      }),
    );

    const res = await withStdin("GOCSPX-abc\n", () =>
      runCliForTest([
        "variables",
        "set",
        "GOOGLE_CLIENT_SECRET",
        "-e",
        "prod",
        "--secret",
        "--non-interactive",
        ...base(cwd),
      ]),
    );

    expect(res.exitCode).toBe(0);
    expect(environment).toBe("prod");
    expect(body).toEqual({ GOOGLE_CLIENT_SECRET: { value: "GOCSPX-abc", secret: true } });
  });

  it("fails rather than blocking when a scripted run pipes nothing in", async () => {
    const cwd = await makeProject();
    const original = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", {
      value: { isTTY: true },
      configurable: true,
    });
    try {
      const res = await runCliForTest([
        "variables",
        "set",
        "TOKEN",
        "--non-interactive",
        ...base(cwd),
      ]);

      expect(res.exitCode).not.toBe(0);
      const json = parseJson(res.stdout) as { code: string; hint: string };
      expect(json.code).toBe("E_VALIDATION");
      expect(json.hint).toContain("Pipe the value in");
    } finally {
      if (original) {
        Object.defineProperty(process, "stdin", original);
      }
    }
  });

  it("rejects a variable name the platform would refuse", async () => {
    const cwd = await makeProject();

    const res = await runCliForTest([
      "variables",
      "set",
      "BAD-NAME",
      "--non-interactive",
      ...base(cwd),
    ]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { status: string; code: string };
    expect(json.code).toBe("E_VALIDATION");
  });

  it("never echoes the value into the envelope", async () => {
    const cwd = await makeProject();
    server.use(http.patch("*/variables", () => HttpResponse.json({})));

    const res = await withStdin("s3cr3t-value", () =>
      runCliForTest(["variables", "set", "TOKEN", "--secret", "--non-interactive", ...base(cwd)]),
    );

    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain("s3cr3t-value");
    expect(res.stderr).not.toContain("s3cr3t-value");
  });

  it("sends no request under --dry-run", async () => {
    const cwd = await makeProject();
    let called = false;
    server.use(
      http.patch("*/variables", () => {
        called = true;
        return HttpResponse.json({});
      }),
    );

    const res = await withStdin("value", () =>
      runCliForTest(["variables", "set", "TOKEN", "--non-interactive", "--dry-run", ...base(cwd)]),
    );

    expect(res.exitCode).toBe(0);
    expect(called).toBe(false);
    const json = parseJson(res.stdout) as { status: string; reason: string };
    expect(json.status).toBe("skipped");
    expect(json.reason).toBe("dry-run");
  });

  it("sets an empty value, which the scalar schema accepts", async () => {
    const cwd = await makeProject();
    let body: Record<string, unknown> = {};
    server.use(
      http.patch("*/variables", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({});
      }),
    );

    const res = await withStdin("", () =>
      runCliForTest(["variables", "set", "EMPTY", "--non-interactive", ...base(cwd)]),
    );

    expect(res.exitCode).toBe(0);
    expect(body).toEqual({ EMPTY: { value: "", secret: false } });
  });

  it("rejects a name longer than the schema allows", async () => {
    const cwd = await makeProject();

    const res = await runCliForTest([
      "variables",
      "set",
      "A".repeat(256),
      "--non-interactive",
      ...base(cwd),
    ]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { code: string };
    expect(json.code).toBe("E_VALIDATION");
  });
});

describe("variables delete", () => {
  it("deletes the name at the addressed owner", async () => {
    const cwd = await makeProject();
    let path = "";
    let environment: string | null = null;
    server.use(
      http.delete("*/variables/:name", ({ request, params }) => {
        path = String(params.name);
        environment = new URL(request.url).searchParams.get("environment_name");
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const res = await runCliForTest([
      "variables",
      "delete",
      "SUPPORT_EMAIL",
      "-e",
      "prod",
      "--non-interactive",
      ...base(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(path).toBe("SUPPORT_EMAIL");
    expect(environment).toBe("prod");
  });

  it("sends no request under --dry-run", async () => {
    const cwd = await makeProject();
    let called = false;
    server.use(
      http.delete("*/variables/:name", () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const res = await runCliForTest([
      "variables",
      "delete",
      "SUPPORT_EMAIL",
      "--non-interactive",
      "--dry-run",
      ...base(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(called).toBe(false);
    const json = parseJson(res.stdout) as { status: string; reason: string };
    expect(json.status).toBe("skipped");
    expect(json.reason).toBe("dry-run");
  });
});

describe("variables import", () => {
  async function withEnvFile(cwd: string, contents: string): Promise<string> {
    const path = join(cwd, ".env.prod");
    await writeFile(path, contents);
    return path;
  }

  it("sends every name in one patch", async () => {
    const cwd = await makeProject();
    const file = await withEnvFile(cwd, "B=2\nA=1\n# comment\n\n");
    let body: Record<string, unknown> = {};
    let calls = 0;
    server.use(
      http.patch("*/variables", async ({ request }) => {
        calls += 1;
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest([
      "variables",
      "import",
      "--file",
      file,
      "-e",
      "prod",
      "--non-interactive",
      ...base(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(calls).toBe(1);
    expect(body).toEqual({
      A: { value: "1", secret: false },
      B: { value: "2", secret: false },
    });
    const json = parseJson(res.stdout) as { data: { names: string[]; count: number } };
    expect(json.data.names).toEqual(["A", "B"]);
    expect(json.data.count).toBe(2);
  });

  it("marks every imported value secret when asked", async () => {
    const cwd = await makeProject();
    const file = await withEnvFile(cwd, "TOKEN=abc\n");
    let body: Record<string, unknown> = {};
    server.use(
      http.patch("*/variables", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({});
      }),
    );

    await runCliForTest([
      "variables",
      "import",
      "--file",
      file,
      "--secret",
      "--non-interactive",
      ...base(cwd),
    ]);

    expect(body).toEqual({ TOKEN: { value: "abc", secret: true } });
  });

  it("reports a missing file rather than throwing", async () => {
    const cwd = await makeProject();

    const res = await runCliForTest([
      "variables",
      "import",
      "--file",
      join(cwd, "absent.env"),
      "--non-interactive",
      ...base(cwd),
    ]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { status: string; code: string };
    expect(json.code).toBe("E_NOT_FOUND");
  });

  it("sends nothing for an empty file", async () => {
    const cwd = await makeProject();
    const file = await withEnvFile(cwd, "# nothing here\n");
    let called = false;
    server.use(
      http.patch("*/variables", () => {
        called = true;
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest([
      "variables",
      "import",
      "--file",
      file,
      "--non-interactive",
      ...base(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(called).toBe(false);
    const json = parseJson(res.stdout) as { data: { count: number } };
    expect(json.data.count).toBe(0);
  });

  it("sends no request under --dry-run", async () => {
    const cwd = await makeProject();
    const file = await withEnvFile(cwd, "A=1\n");
    let called = false;
    server.use(
      http.patch("*/variables", () => {
        called = true;
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest([
      "variables",
      "import",
      "--file",
      file,
      "--non-interactive",
      "--dry-run",
      ...base(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(called).toBe(false);
    const json = parseJson(res.stdout) as { status: string; reason: string };
    expect(json.reason).toBe("dry-run");
  });
});
