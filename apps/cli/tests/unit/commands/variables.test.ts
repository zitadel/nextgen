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

/** Writes a `zitadel.json`, for the runs that exercise server resolution. */
async function writeConfig(cwd: string, config: unknown): Promise<void> {
  await writeFile(join(cwd, "zitadel.json"), JSON.stringify(config), "utf8");
}

/** The plain rendering: no `--json`. */
const plainArgs = (cwd: string) => ["--cwd", cwd, "--server", SERVER, "--non-interactive"];

/** Run as though stdout were a terminal; under the test runner it is a pipe. */
async function asTerminal<T>(run: () => Promise<T>): Promise<T> {
  const tty = process.stdout.isTTY;
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  try {
    return await run();
  } finally {
    Object.defineProperty(process.stdout, "isTTY", { value: tty, configurable: true });
  }
}

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
  it("returns the project's variables, withholding secret values", async () => {
    const cwd = await makeProject();
    server.use(
      http.get("*/variables", () =>
        HttpResponse.json({
          GOOGLE_CLIENT_SECRET: { secret: true },
          GOOGLE_CLIENT_ID: "999-prod",
        }),
      ),
    );

    const res = await runCliForTest(["variables", "list", "--project-level", ...base(cwd)]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { count: number; variables: Array<Record<string, unknown>> };
    };
    expect(json.status).toBe("ok");
    expect(json.data.count).toBe(2);
    expect(json.data.variables).toEqual([
      { name: "GOOGLE_CLIENT_ID", secret: false, value: "999-prod" },
      { name: "GOOGLE_CLIENT_SECRET", secret: true },
    ]);
    // One owner, so the envelope states none: a permanent `null` would read as
    // a value the run could have chosen.
    expect(json.data).not.toHaveProperty("environment");
  });

  it("never emits a value key for a secret", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables", () => HttpResponse.json({ S: { secret: true } })));

    const res = await runCliForTest(["variables", "list", "--project-level", ...base(cwd)]);

    const json = parseJson(res.stdout) as { data: { variables: Array<Record<string, unknown>> } };
    expect(json.data.variables[0]).not.toHaveProperty("value");
  });

  it("sends no environment_name, so the project level is the owner", async () => {
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
    const json = parseJson(res.stdout) as { data: { count: number } };
    expect(json.data.count).toBe(0);
  });

  it("prints tab-separated rows with no header on a pipe, and nothing when empty", async () => {
    const cwd = await makeProject();
    let call = 0;
    server.use(
      http.get("*/variables", () =>
        HttpResponse.json(call++ === 0 ? { B: "two", A: { secret: true } } : {}),
      ),
    );

    const rows = await runCliForTest(["variables", "list", "--project-level", ...plainArgs(cwd)]);
    const empty = await runCliForTest(["variables", "list", "--project-level", ...plainArgs(cwd)]);

    expect(rows.exitCode).toBe(0);
    expect(rows.stdout.trim().split("\n")).toEqual(["A\t(secret)", "B\ttwo"]);
    expect(empty.exitCode).toBe(0);
    expect(empty.stdout.trim()).toBe("");
  });

  it("renders a table and a count on a terminal, unless --plain", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables", () => HttpResponse.json({ V: "one\ntwo\u001b[31m" })));

    const table = await asTerminal(() =>
      runCliForTest(["variables", "list", "--project-level", ...plainArgs(cwd)]),
    );
    const plain = await asTerminal(() =>
      runCliForTest(["variables", "list", "--project-level", "--plain", ...plainArgs(cwd)]),
    );

    expect(table.stdout).toMatch(/name\s+value/);
    expect(table.stdout).toContain("1 variable");
    // Escaped, so the value can neither break the row nor drive the terminal.
    expect(table.stdout).not.toContain("\u001b");
    expect(table.stdout).toContain("one\\x0atwo\\x1b[31m");
    expect(plain.stdout).not.toMatch(/name\s+value/);
    expect(plain.stdout).toContain("V\tone\\x0atwo");
  });

  it("says so on a terminal when the project holds nothing", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables", () => HttpResponse.json({})));

    const res = await asTerminal(() =>
      runCliForTest(["variables", "list", "--project-level", ...plainArgs(cwd)]),
    );

    expect(res.stdout).toContain("No variables on the project.");
  });

  it("no longer resolves as though `development` had been named", async () => {
    const cwd = await makeProject();
    // A command with no `--environment` once resolved as though it had been
    // given `development`, so this block became the server. With no top-level
    // `server` the run now falls through to the default, which is what the
    // handler below answers on.
    await writeConfig(cwd, {
      project: "proj_test",
      environments: { development: { server: "https://dev.example" } },
    });
    let hit = "";
    server.use(
      http.get("*/variables", ({ request }) => {
        hit = new URL(request.url).origin;
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest([
      "variables",
      "list",
      "--project-level",
      "--cwd",
      cwd,
      "--json",
    ]);

    expect(res.exitCode).toBe(0);
    expect(hit).toBe(SERVER);
  });

  it("prints the project and the server on a terminal, and neither on a pipe", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables", () => HttpResponse.json({ A: "b" })));

    // The harness captures stdout, so process.stdout.isTTY is undefined here —
    // the same condition a pipe or a redirect creates.
    const piped = await runCliForTest(["variables", "list", "--project-level", ...plainArgs(cwd)]);
    const terminal = await asTerminal(() =>
      runCliForTest(["variables", "list", "--project-level", ...plainArgs(cwd)]),
    );

    expect(piped.exitCode).toBe(0);
    expect(piped.stdout).not.toContain("Project   ");
    expect(piped.stdout).not.toContain("Server    ");
    expect(piped.stdout.trim()).toBe("A\tb");
    expect(terminal.stdout).toContain("proj_test");
    expect(terminal.stdout).toContain(SERVER);
  });

  it("ignores a per-environment server block in zitadel.json", async () => {
    const cwd = await makeProject();
    // `zitadel.json` names one server for the project and another under an
    // environment. Nothing reads the per-environment entry, so the project's
    // own server serves the request. No `--server` here: that flag
    // short-circuits resolution and would hide it.
    await writeConfig(cwd, {
      project: "proj_test",
      server: SERVER,
      environments: { prod: { server: "https://elsewhere.example" } },
    });
    let hit = "";
    server.use(
      http.get("*/variables", ({ request }) => {
        hit = new URL(request.url).origin;
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest([
      "variables",
      "list",
      "--project-level",
      "--cwd",
      cwd,
      "--json",
    ]);

    expect(res.exitCode).toBe(0);
    expect(hit).toBe(SERVER);
  });
});

describe("variables get", () => {
  it("returns a non-secret value, addressing the project level", async () => {
    const cwd = await makeProject();
    let path = "";
    let environment: string | null = "unset";
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
      "--project-level",
      ...base(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(path).toBe("GOOGLE_CLIENT_ID");
    expect(environment).toBeNull();
    const json = parseJson(res.stdout) as {
      data: { name: string; secret: boolean; value: string };
    };
    expect(json.data).toEqual({
      name: "GOOGLE_CLIENT_ID",
      secret: false,
      value: "999-prod",
    });
  });

  it("prints the whole record on a pipe, as every other get does", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables/:name", () => HttpResponse.json("999-prod")));

    const res = await runCliForTest([
      "variables",
      "get",
      "GOOGLE_CLIENT_ID",
      "--project-level",
      ...plainArgs(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({
      name: "GOOGLE_CLIENT_ID",
      secret: false,
      value: "999-prod",
    });
  });

  it("gives a pipe no value to capture for a secret", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables/:name", () => HttpResponse.json({ secret: true })));

    const res = await runCliForTest([
      "variables",
      "get",
      "TOKEN",
      "--project-level",
      ...plainArgs(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ name: "TOKEN", secret: true });
  });

  it("lays the record out field by field on a terminal", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables/:name", () => HttpResponse.json("999-prod")));

    const res = await asTerminal(() =>
      runCliForTest(["variables", "get", "GOOGLE_CLIENT_ID", "--project-level", ...plainArgs(cwd)]),
    );

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("GOOGLE_CLIENT_ID");
    expect(res.stdout).toMatch(/value\s+999-prod/);
  });

  it("marks a secret, and shows an empty value, on a terminal", async () => {
    const cwd = await makeProject();
    server.use(
      http.get("*/variables/:name", ({ params }) =>
        HttpResponse.json(params.name === "TOKEN" ? { secret: true } : ""),
      ),
    );

    const secret = await asTerminal(() =>
      runCliForTest(["variables", "get", "TOKEN", "--project-level", ...plainArgs(cwd)]),
    );
    const empty = await asTerminal(() =>
      runCliForTest(["variables", "get", "BLANK", "--project-level", ...plainArgs(cwd)]),
    );

    expect(secret.stdout).toMatch(/value\s+\(secret\)/);
    expect(empty.stdout).toMatch(/value\s+""/);
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

    const res = await asTerminal(() =>
      runCliForTest(["variables", "get", "NASTY", "--project-level", ...plainArgs(cwd)]),
    );

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
    let environment: string | null = "unset";
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
        "--project-level",
        "--secret",
        "--non-interactive",
        ...base(cwd),
      ]),
    );

    expect(res.exitCode).toBe(0);
    expect(environment).toBeNull();
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
        "--project-level",
        "--secret",
        "--non-interactive",
        ...base(cwd),
      ]);

      expect(res.exitCode).not.toBe(0);
      const json = parseJson(res.stdout) as { next_commands: string[]; hint: string };
      const retry = json.next_commands.join(" ");
      // Dropping the owner or the secret flag would hand back a command that
      // names no owner, or writes the credential as a readable value.
      expect(retry).toContain("--project-level");
      expect(retry).toContain("--secret");
      expect(json.hint).toContain("--project-level");
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
    expect(json.data).not.toHaveProperty("environment");
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
        "--project-level",
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
  it("deletes the name at the project level", async () => {
    const cwd = await makeProject();
    let path = "";
    let environment: string | null = "unset";
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
      "--project-level",
      "--non-interactive",
      "--force",
      ...base(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(path).toBe("SUPPORT_EMAIL");
    expect(environment).toBeNull();
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
    expect(json.data).not.toHaveProperty("environment");
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

describe("naming the owner", () => {
  it("refuses a run that names no owner, on a terminal as in a script", async () => {
    const cwd = await makeProject();
    let requested = false;
    server.use(
      http.get("*/variables", () => {
        requested = true;
        return HttpResponse.json({});
      }),
    );

    const scripted = await runCliForTest(["variables", "list", ...base(cwd)]);
    const terminal = await asTerminal(() =>
      runCliForTest(["variables", "list", "--cwd", cwd, "--json", "--server", SERVER]),
    );

    expect(scripted.exitCode).not.toBe(0);
    expect(terminal.exitCode).not.toBe(0);
    expect(requested).toBe(false);
    for (const res of [scripted, terminal]) {
      const json = parseJson(res.stdout) as { code: string; message: string; hint: string };
      expect(json.code).toBe("E_VALIDATION");
      expect(json.message).toContain("--project-level");
      // The refusal has to say why there is nothing else to name, or it reads
      // as a flag someone forgot rather than the only owner there is.
      expect(json.hint).toContain("--environment");
    }
  });

  it("refuses before reading the value, so a secret is never read for nothing", async () => {
    const cwd = await makeProject();
    // A stream that records whether anything drew on it. The owner is settled
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

  it.each(["-e", "--environment", "--env"])(
    "no longer accepts %s, which named an environment",
    async (flag) => {
      const cwd = await makeProject();

      const res = await runCliForTest([
        "variables",
        "list",
        flag,
        "prod",
        "--project-level",
        ...base(cwd),
      ]);

      expect(res.exitCode).not.toBe(0);
      const json = parseJson(res.stdout) as { code: string; message: string };
      expect(json.code).toBe("E_VALIDATION");
      expect(json.message).toContain("Nonexistent flag");
    },
  );

  // Every command inherits the owner flag from one base class, so each one has
  // to refuse: a command that quietly resolved an owner would write where the
  // run never said to.
  it.each([
    ["list", ["variables", "list"]],
    ["get", ["variables", "get", "GOOGLE_CLIENT_ID"]],
    ["set", ["variables", "set", "GOOGLE_CLIENT_ID"]],
    ["delete", ["variables", "delete", "GOOGLE_CLIENT_ID", "--force"]],
  ])("refuses %s when no owner is named, before any request", async (_verb, argv) => {
    const cwd = await makeProject();
    let requested = false;
    const record = () => {
      requested = true;
      return HttpResponse.json({});
    };
    server.use(
      http.get("*/variables", record),
      http.get("*/variables/:name", record),
      http.patch("*/variables", record),
      http.delete("*/variables/:name", record),
    );

    const res = await runCliForTest([...argv, ...base(cwd)]);

    expect(res.exitCode).not.toBe(0);
    expect(requested).toBe(false);
    const json = parseJson(res.stdout) as { code: string; message: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("--project-level");
  });

  it("refuses under --dry-run too, so a preview cannot imply an owner", async () => {
    const cwd = await makeProject();
    let requested = false;
    server.use(
      http.patch("*/variables", () => {
        requested = true;
        return HttpResponse.json({});
      }),
    );

    const res = await withStdin("v", () =>
      runCliForTest(["variables", "set", "TOKEN", "--dry-run", ...base(cwd)]),
    );

    expect(res.exitCode).not.toBe(0);
    expect(requested).toBe(false);
    const json = parseJson(res.stdout) as { code: string; message: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("--project-level");
  });

  it("suggests the same run with the owner named, as a command an agent can re-run", async () => {
    const cwd = await makeProject();

    const res = await runCliForTest(["variables", "get", "GOOGLE_CLIENT_ID", ...base(cwd)]);

    const json = parseJson(res.stdout) as { next_commands: string[] };
    const retry = json.next_commands.join(" ");
    // The retry has to carry the whole run, not just the flag: a bare
    // `--project-level` would drop the name being read.
    expect(retry).toContain("variables get GOOGLE_CLIENT_ID");
    expect(retry).toContain("--project-level");
  });
});
