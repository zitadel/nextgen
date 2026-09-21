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

    const res = await runCliForTest(["variables", "list", "--project-level", ...base(cwd)]);

    const json = parseJson(res.stdout) as { data: { variables: Array<Record<string, unknown>> } };
    expect(json.data.variables[0]).not.toHaveProperty("value");
  });

  it("addresses the project level with --project-level", async () => {
    const cwd = await makeProject();
    let seen: string | null = "unset";
    server.use(
      http.get("*/variables", ({ request }) => {
        seen = new URL(request.url).searchParams.get("environment_name");
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest(["variables", "list", "--project-level", ...base(cwd)]);

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

describe("variables get", () => {
  it("returns a non-secret value and addresses the named owner", async () => {
    const cwd = await makeProject();
    let path = "";
    let environment: string | null = null;
    server.use(
      http.get("*/variables/:name", ({ request, params }) => {
        path = String(params.name);
        environment = new URL(request.url).searchParams.get("environment_name");
        return HttpResponse.json("999-prod");
      }),
    );

    const res = await runCliForTest([
      "variables",
      "get",
      "GOOGLE_CLIENT_ID",
      "-e",
      "prod",
      ...base(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(path).toBe("GOOGLE_CLIENT_ID");
    expect(environment).toBe("prod");
    const json = parseJson(res.stdout) as {
      data: { name: string; secret: boolean; value: string; environment: string };
    };
    expect(json.data).toEqual({
      environment: "prod",
      name: "GOOGLE_CLIENT_ID",
      secret: false,
      value: "999-prod",
    });
  });

  it("prints only the value on a pipe, so it can be captured by a script", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables/:name", () => HttpResponse.json("999-prod")));

    // No `--json`: this is the plain rendering a `$(zitadel variables get …)`
    // would capture. Under the test runner stdout is not a TTY, as on a pipe.
    const res = await runCliForTest([
      "variables",
      "get",
      "GOOGLE_CLIENT_ID",
      "--project-level",
      "--cwd",
      cwd,
      "--server",
      SERVER,
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("999-prod");
    expect(res.stdout).not.toContain("Project");
    expect(res.stdout).not.toContain("Server");
  });

  it("reports a secret as held and carries no value", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables/:name", () => HttpResponse.json({ secret: true })));

    const res = await runCliForTest(["variables", "get", "TOKEN", "--project-level", ...base(cwd)]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: Record<string, unknown> };
    expect(json.data.secret).toBe(true);
    expect(json.data).not.toHaveProperty("value");
  });

  it("escapes a value that would otherwise drive the terminal", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables/:name", () => HttpResponse.json("a\u001b[31mb")));

    const res = await runCliForTest([
      "variables",
      "get",
      "NASTY",
      "--project-level",
      "--cwd",
      cwd,
      "--server",
      SERVER,
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain("\u001b");
    expect(res.stdout).toContain("a\\x1b[31mb");
  });

  it("rejects a variable name the platform would refuse", async () => {
    const cwd = await makeProject();

    const res = await runCliForTest([
      "variables",
      "get",
      "BAD-NAME",
      "--project-level",
      ...base(cwd),
    ]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { code: string };
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
        "--project-level",
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

  it('stores an empty submission as "" rather than the string undefined', async () => {
    const cwd = await makeProject();
    let body: Record<string, unknown> = {};
    server.use(
      http.patch("*/variables", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({});
      }),
    );

    const res = await withStdin("", () =>
      runCliForTest([
        "variables",
        "set",
        "BLANK",
        "--project-level",
        "--non-interactive",
        ...base(cwd),
      ]),
    );

    expect(res.exitCode).toBe(0);
    expect(body).toEqual({ BLANK: { value: "", secret: false } });
    expect(JSON.stringify(body)).not.toContain("undefined");
  });

  it("suggests a retry that reproduces the run, not a weaker one", async () => {
    const cwd = await makeProject();
    const original = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", { value: { isTTY: true }, configurable: true });
    try {
      const res = await runCliForTest([
        "variables",
        "set",
        "TOKEN",
        "-e",
        "prod",
        "--secret",
        "--non-interactive",
        ...base(cwd),
      ]);

      expect(res.exitCode).not.toBe(0);
      const json = parseJson(res.stdout) as { next_commands: string[]; hint: string };
      const retry = json.next_commands.join(" ");
      // Dropping either would hand back a command writing a non-secret at the
      // project level: a different owner and a weaker classification.
      expect(retry).toContain("--environment prod");
      expect(retry).toContain("--secret");
      expect(json.hint).toContain("--environment prod");
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
      "--project-level",
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
      runCliForTest([
        "variables",
        "set",
        "TOKEN",
        "--project-level",
        "--secret",
        "--non-interactive",
        ...base(cwd),
      ]),
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
      runCliForTest([
        "variables",
        "set",
        "TOKEN",
        "--project-level",
        "--non-interactive",
        "--dry-run",
        ...base(cwd),
      ]),
    );

    expect(res.exitCode).toBe(0);
    expect(called).toBe(false);
    const json = parseJson(res.stdout) as { status: string; data: Record<string, unknown> };
    expect(json.status).toBe("ok");
    // The resource commands' dry-run contract, marked as a preview, with the
    // requested classification and type — and no value, which was never read.
    expect(json.data).toMatchObject({
      dry_run: true,
      verb: "set",
      topic: "variables",
      id: "TOKEN",
      secret: false,
      as: "string",
    });
    expect(json.data).not.toHaveProperty("value");
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
      runCliForTest([
        "variables",
        "set",
        "EMPTY",
        "--project-level",
        "--non-interactive",
        ...base(cwd),
      ]),
    );

    expect(res.exitCode).toBe(0);
    expect(body).toEqual({ EMPTY: { value: "", secret: false } });
  });

  it("rejects a name longer than the schema allows", async () => {
    const cwd = await makeProject();
    // A value and a PATCH handler are supplied so that, were the cap missing,
    // the command would run to completion and fail these assertions at once
    // rather than block on stdin until the test times out.
    let patched = false;
    server.use(
      http.patch("*/variables", () => {
        patched = true;
        return HttpResponse.json({});
      }),
    );

    const res = await withStdin("value", () =>
      runCliForTest([
        "variables",
        "set",
        "A".repeat(256),
        "--project-level",
        "--non-interactive",
        ...base(cwd),
      ]),
    );

    expect(patched).toBe(false);
    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { code: string; message: string };
    expect(json.code).toBe("E_VALIDATION");
    // Assert the cap itself fired, not merely that something was rejected: a
    // malformed argument list would also exit E_VALIDATION.
    expect(json.message).toContain("the limit is 255");
  });
});

describe("variables set --as", () => {
  const capture = () => {
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.patch("*/variables", async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({});
      }),
    );
    return bodies;
  };

  it("stores a number as a JSON number, not a string", async () => {
    const cwd = await makeProject();
    const bodies = capture();

    const res = await withStdin("5", () =>
      runCliForTest([
        "variables",
        "set",
        "RETRY_COUNT",
        "--project-level",
        "--as",
        "number",
        "--non-interactive",
        ...base(cwd),
      ]),
    );

    expect(res.exitCode).toBe(0);
    expect(bodies).toEqual([{ RETRY_COUNT: { value: 5, secret: false } }]);
  });

  it("stores a boolean as a JSON boolean", async () => {
    const cwd = await makeProject();
    const bodies = capture();

    await withStdin("true", () =>
      runCliForTest([
        "variables",
        "set",
        "DEBUG",
        "--project-level",
        "--as",
        "boolean",
        "--non-interactive",
        ...base(cwd),
      ]),
    );

    expect(bodies).toEqual([{ DEBUG: { value: true, secret: false } }]);
  });

  it('keeps a string by default, so 5 stays "5" unless asked otherwise', async () => {
    const cwd = await makeProject();
    const bodies = capture();

    await withStdin("5", () =>
      runCliForTest([
        "variables",
        "set",
        "ZIP",
        "--project-level",
        "--non-interactive",
        ...base(cwd),
      ]),
    );

    expect(bodies).toEqual([{ ZIP: { value: "5", secret: false } }]);
  });

  it("refuses a value that is not the stated type, sending nothing", async () => {
    const cwd = await makeProject();
    const bodies = capture();

    const res = await withStdin("abc", () =>
      runCliForTest([
        "variables",
        "set",
        "RETRY_COUNT",
        "--project-level",
        "--as",
        "number",
        "--non-interactive",
        ...base(cwd),
      ]),
    );

    expect(res.exitCode).not.toBe(0);
    expect(bodies).toEqual([]);
    const json = parseJson(res.stdout) as { code: string };
    expect(json.code).toBe("E_VALIDATION");
  });

  it("refuses a typed secret before reading the value", async () => {
    const cwd = await makeProject();
    const bodies = capture();
    let consumed = false;
    const stdin = new Readable({
      read() {
        consumed = true;
        this.push("12345");
        this.push(null);
      },
    });
    const original = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
    try {
      const res = await runCliForTest([
        "variables",
        "set",
        "API_KEY",
        "--project-level",
        "--secret",
        "--as",
        "number",
        "--non-interactive",
        ...base(cwd),
      ]);

      expect(res.exitCode).not.toBe(0);
      expect(bodies).toEqual([]);
      expect(consumed).toBe(false);
      const json = parseJson(res.stdout) as { message: string };
      expect(json.message).toContain("A secret is stored as a string");
    } finally {
      if (original) {
        Object.defineProperty(process, "stdin", original);
      }
    }
  });

  it("keeps --as in the retry it suggests", async () => {
    const cwd = await makeProject();
    const original = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", { value: { isTTY: true }, configurable: true });
    try {
      const res = await runCliForTest([
        "variables",
        "set",
        "RETRY_COUNT",
        "-e",
        "prod",
        "--as",
        "number",
        "--non-interactive",
        ...base(cwd),
      ]);

      const json = parseJson(res.stdout) as { next_commands: string[] };
      expect(json.next_commands.join(" ")).toContain("--as number");
    } finally {
      if (original) {
        Object.defineProperty(process, "stdin", original);
      }
    }
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
      "--force",
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
      "--project-level",
      "--non-interactive",
      "--force",
      "--dry-run",
      ...base(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(called).toBe(false);
    const json = parseJson(res.stdout) as { status: string; data: Record<string, unknown> };
    expect(json.status).toBe("ok");
    expect(json.data).toMatchObject({
      dry_run: true,
      verb: "delete",
      topic: "variables",
      id: "SUPPORT_EMAIL",
    });
    // Nothing was deleted, so the preview must not say it was.
    expect(json.data).not.toHaveProperty("deleted");
  });

  it("refuses to delete without --force in non-interactive mode", async () => {
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
      "--project-level",
      "--non-interactive",
      ...base(cwd),
    ]);

    expect(res.exitCode).not.toBe(0);
    expect(called).toBe(false);
    const json = parseJson(res.stdout) as { code: string; next_commands: string[] };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.next_commands.join(" ")).toContain("--force");
  });
});

describe("choosing the owner", () => {
  const environments = () =>
    http.get("*/environments", () =>
      HttpResponse.json({
        environments: ["dev", "staging", "prod"].map((name) => ({
          id: `env_${name}`,
          project_id: "proj_test",
          name,
          created_at: "2026-01-01T00:00:00Z",
        })),
      }),
    );

  it("refuses a non-interactive run that names no owner, listing the environments", async () => {
    const cwd = await makeProject();
    let requested = false;
    server.use(
      environments(),
      http.get("*/variables", () => {
        requested = true;
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest(["variables", "list", ...base(cwd)]);

    expect(res.exitCode).not.toBe(0);
    expect(requested).toBe(false);
    const json = parseJson(res.stdout) as { code: string; message: string; hint: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("--environment");
    expect(json.message).toContain("--project-level");
    expect(json.hint).toContain("dev, staging, prod");
    // The trap this closes is the silent project-level write, so the refusal
    // says why the choice matters.
    expect(json.hint).toContain("do not inherit");
  });

  it("still refuses for the missing owner when the environments cannot be listed", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/environments", () => HttpResponse.json({}, { status: 500 })));

    const res = await runCliForTest(["variables", "list", ...base(cwd)]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { code: string; message: string };
    // Not E_NETWORK: the listing only enriches the refusal.
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("--project-level");
  });

  it("refuses before reading the value, so a secret is never read for nothing", async () => {
    const cwd = await makeProject();
    server.use(environments());
    // A stream that records whether anything drew on it. The owner is resolved
    // before the value is read; if that order were reversed, the value would be
    // consumed and then thrown away by the refusal.
    let consumed = false;
    const stdin = new Readable({
      read() {
        consumed = true;
        this.push("GOCSPX-abc");
        this.push(null);
      },
    });
    const original = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
    try {
      const res = await runCliForTest(["variables", "set", "TOKEN", "--secret", ...base(cwd)]);

      expect(res.exitCode).not.toBe(0);
      const json = parseJson(res.stdout) as { message: string };
      expect(json.message).toContain("--project-level");
      expect(consumed).toBe(false);
    } finally {
      if (original) {
        Object.defineProperty(process, "stdin", original);
      }
    }
  });

  it("accepts --env as an alias for --environment", async () => {
    const cwd = await makeProject();
    const seen: Array<string | null> = [];
    server.use(
      http.get("*/variables", ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("environment_name"));
        return HttpResponse.json({});
      }),
    );

    await runCliForTest(["variables", "list", "--env", "prod", ...base(cwd)]);
    await runCliForTest(["variables", "list", "--environment", "prod", ...base(cwd)]);
    await runCliForTest(["variables", "list", "-e", "prod", ...base(cwd)]);

    expect(seen).toEqual(["prod", "prod", "prod"]);
  });

  it("does not accept both an environment and the project level", async () => {
    const cwd = await makeProject();

    const res = await runCliForTest([
      "variables",
      "list",
      "-e",
      "prod",
      "--project-level",
      ...base(cwd),
    ]);

    expect(res.exitCode).not.toBe(0);
  });
});
