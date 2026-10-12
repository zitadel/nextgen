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
 * Run with `value` on stdin, the way a scripted `zitadel variable set NAME <
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

describe("variable list", () => {
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

    const res = await runCliForTest(["variable", "list", ...base(cwd)]);

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

    const res = await runCliForTest(["variable", "list", ...base(cwd)]);

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

    const res = await runCliForTest(["variable", "list", ...base(cwd)]);

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

    const rows = await runCliForTest(["variable", "list", ...plainArgs(cwd)]);
    const empty = await runCliForTest(["variable", "list", ...plainArgs(cwd)]);

    expect(rows.exitCode).toBe(0);
    expect(rows.stdout.trim().split("\n")).toEqual(["A\t(secret)", "B\ttwo"]);
    expect(empty.exitCode).toBe(0);
    expect(empty.stdout.trim()).toBe("");
  });

  it("renders a table and a count on a terminal, unless --plain", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables", () => HttpResponse.json({ V: "one\ntwo\u001b[31m" })));

    const table = await asTerminal(() => runCliForTest(["variable", "list", ...plainArgs(cwd)]));
    const plain = await asTerminal(() =>
      runCliForTest(["variable", "list", "--plain", ...plainArgs(cwd)]),
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

    const res = await asTerminal(() => runCliForTest(["variable", "list", ...plainArgs(cwd)]));

    expect(res.stdout).toContain("No variables on the project.");
  });

  it("refuses to guess a server when nothing names one", async () => {
    const cwd = await makeProject();
    // `zitadel.json` once named the server, and a command without `--server`
    // fell back to the cloud. Neither is a source now: the server is the
    // environment's `ZITADEL_URL`, or it is missing.
    await writeConfig(cwd, { project: "proj_test", server: "https://elsewhere.example" });
    let requested = false;
    server.use(
      http.get("*/variables", () => {
        requested = true;
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest(["variable", "list", "--cwd", cwd, "--json"]);

    expect(res.exitCode).not.toBe(0);
    expect(requested).toBe(false);
    const json = parseJson(res.stdout) as { code: string; message: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("ZITADEL_URL");
  });

  it("prints the project and the server on a terminal, and neither on a pipe", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables", () => HttpResponse.json({ A: "b" })));

    // The harness captures stdout, so process.stdout.isTTY is undefined here —
    // the same condition a pipe or a redirect creates.
    const piped = await runCliForTest(["variable", "list", ...plainArgs(cwd)]);
    const terminal = await asTerminal(() => runCliForTest(["variable", "list", ...plainArgs(cwd)]));

    expect(piped.exitCode).toBe(0);
    expect(piped.stdout).not.toContain("Project   ");
    expect(piped.stdout).not.toContain("Server    ");
    expect(piped.stdout.trim()).toBe("A\tb");
    expect(terminal.stdout).toContain("proj_test");
    expect(terminal.stdout).toContain(SERVER);
  });

  it("takes the server from ZITADEL_URL, not from zitadel.json", async () => {
    const cwd = await makeProject();
    await writeConfig(cwd, { project: "proj_test", server: "https://elsewhere.example" });
    await writeFile(join(cwd, ".env.local"), `ZITADEL_URL=${SERVER}\n`);
    let hit = "";
    server.use(
      http.get("*/variables", ({ request }) => {
        hit = new URL(request.url).origin;
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest(["variable", "list", "--cwd", cwd, "--json"]);

    expect(res.exitCode).toBe(0);
    expect(hit).toBe(SERVER);
  });
});

describe("variable get", () => {
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

    const res = await runCliForTest(["variable", "get", "GOOGLE_CLIENT_ID", ...base(cwd)]);

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

    const res = await runCliForTest(["variable", "get", "GOOGLE_CLIENT_ID", ...plainArgs(cwd)]);

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

    const res = await runCliForTest(["variable", "get", "TOKEN", ...plainArgs(cwd)]);

    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ name: "TOKEN", secret: true });
  });

  it("lays the record out field by field on a terminal", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables/:name", () => HttpResponse.json("999-prod")));

    const res = await asTerminal(() =>
      runCliForTest(["variable", "get", "GOOGLE_CLIENT_ID", ...plainArgs(cwd)]),
    );

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("GOOGLE_CLIENT_ID");
    expect(res.stdout).toMatch(/value\s+999-prod/);
    // The owner row is gone: every run addresses the same one.
    expect(res.stdout).not.toContain("environment");
  });

  it("marks a secret, and shows an empty value, on a terminal", async () => {
    const cwd = await makeProject();
    server.use(
      http.get("*/variables/:name", ({ params }) =>
        HttpResponse.json(params.name === "TOKEN" ? { secret: true } : ""),
      ),
    );

    const secret = await asTerminal(() =>
      runCliForTest(["variable", "get", "TOKEN", ...plainArgs(cwd)]),
    );
    const empty = await asTerminal(() =>
      runCliForTest(["variable", "get", "BLANK", ...plainArgs(cwd)]),
    );

    expect(secret.stdout).toMatch(/value\s+\(secret\)/);
    expect(empty.stdout).toMatch(/value\s+""/);
  });

  it("reports a secret as held and carries no value", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables/:name", () => HttpResponse.json({ secret: true })));

    const res = await runCliForTest(["variable", "get", "TOKEN", ...base(cwd)]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: Record<string, unknown> };
    expect(json.data.secret).toBe(true);
    expect(json.data).not.toHaveProperty("value");
  });

  it("escapes a value that would otherwise drive the terminal", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables/:name", () => HttpResponse.json("a\u001b[31mb")));

    const res = await asTerminal(() =>
      runCliForTest(["variable", "get", "NASTY", ...plainArgs(cwd)]),
    );

    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain("\u001b");
    expect(res.stdout).toContain("a\\x1b[31mb");
  });

  it("rejects a variable name the platform would refuse", async () => {
    const cwd = await makeProject();

    const res = await runCliForTest(["variable", "get", "BAD-NAME", ...base(cwd)]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { code: string };
    expect(json.code).toBe("E_VALIDATION");
  });
});

describe("variable set", () => {
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
        "variable",
        "set",
        "GOOGLE_CLIENT_SECRET",
        "--secret",
        "--non-interactive",
        ...base(cwd),
      ]),
    );

    expect(res.exitCode).toBe(0);
    expect(environment).toBeNull();
    expect(body).toEqual({ GOOGLE_CLIENT_SECRET: { value: "GOCSPX-abc", secret: true } });
    const json = parseJson(res.stdout) as { data: Record<string, unknown> };
    expect(json.data).toEqual({
      name: "GOOGLE_CLIENT_SECRET",
      secret: true,
      type: "string",
      applies_to: "all",
    });
  });

  it("says on a terminal that the value was set on the project", async () => {
    const cwd = await makeProject();
    server.use(http.patch("*/variables", () => HttpResponse.json({})));

    const plain = await asTerminal(() =>
      withStdin("v", () => runCliForTest(["variable", "set", "TOKEN", ...plainArgs(cwd)])),
    );
    const secret = await asTerminal(() =>
      withStdin("v", () =>
        runCliForTest(["variable", "set", "TOKEN", "--secret", ...plainArgs(cwd)]),
      ),
    );

    expect(plain.stdout).toContain("Set TOKEN on the project");
    expect(plain.stdout).not.toContain("(secret)");
    expect(secret.stdout).toContain("Set TOKEN on the project (secret)");
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
        "variable",
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
      runCliForTest(["variable", "set", "BLANK", "--non-interactive", ...base(cwd)]),
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
        "variable",
        "set",
        "TOKEN",
        "--secret",
        "--non-interactive",
        ...base(cwd),
      ]);

      expect(res.exitCode).not.toBe(0);
      const json = parseJson(res.stdout) as { next_commands: string[]; hint: string };
      const retry = json.next_commands.join(" ");
      // Dropping the secret flag would hand back a command that writes the
      // credential as a readable value.
      expect(retry).toContain("variable set TOKEN");
      expect(retry).toContain("--secret");
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
      "variable",
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
      runCliForTest(["variable", "set", "TOKEN", "--secret", "--non-interactive", ...base(cwd)]),
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
      runCliForTest(["variable", "set", "TOKEN", "--non-interactive", "--dry-run", ...base(cwd)]),
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
      topic: "variable",
      id: "TOKEN",
      secret: false,
      as: "string",
    });
    expect(json.data).not.toHaveProperty("value");
    expect(json.data).not.toHaveProperty("environment");
  });

  it("previews the write on the project under --dry-run", async () => {
    const cwd = await makeProject();

    const res = await asTerminal(() =>
      withStdin("5", () =>
        runCliForTest([
          "variable",
          "set",
          "RETRY_COUNT",
          "--as",
          "number",
          "--dry-run",
          ...plainArgs(cwd),
        ]),
      ),
    );

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("on the project");
    expect(res.stdout).toContain("as number");
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
      runCliForTest(["variable", "set", "EMPTY", "--non-interactive", ...base(cwd)]),
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
      runCliForTest(["variable", "set", "A".repeat(256), "--non-interactive", ...base(cwd)]),
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

describe("variable set --as", () => {
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
        "variable",
        "set",
        "RETRY_COUNT",
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
        "variable",
        "set",
        "DEBUG",
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
      runCliForTest(["variable", "set", "ZIP", "--non-interactive", ...base(cwd)]),
    );

    expect(bodies).toEqual([{ ZIP: { value: "5", secret: false } }]);
  });

  it("refuses a value that is not the stated type, sending nothing", async () => {
    const cwd = await makeProject();
    const bodies = capture();

    const res = await withStdin("abc", () =>
      runCliForTest([
        "variable",
        "set",
        "RETRY_COUNT",
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
        "variable",
        "set",
        "API_KEY",
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
        "variable",
        "set",
        "RETRY_COUNT",
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

describe("variable rm", () => {
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
      "variable",
      "rm",
      "SUPPORT_EMAIL",
      "--non-interactive",
      "--force",
      ...base(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(path).toBe("SUPPORT_EMAIL");
    expect(environment).toBeNull();
    const json = parseJson(res.stdout) as { data: Record<string, unknown> };
    expect(json.data).toEqual({ name: "SUPPORT_EMAIL", deleted: true, applies_to: "all" });
  });

  it("says on a terminal that the name was removed from the project", async () => {
    const cwd = await makeProject();
    server.use(http.delete("*/variables/:name", () => new HttpResponse(null, { status: 204 })));

    const res = await asTerminal(() =>
      runCliForTest(["variable", "rm", "SUPPORT_EMAIL", "--force", ...plainArgs(cwd)]),
    );

    expect(res.stdout).toContain("Removed SUPPORT_EMAIL from the project");
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
      "variable",
      "rm",
      "SUPPORT_EMAIL",
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
      verb: "remove",
      topic: "variable",
      id: "SUPPORT_EMAIL",
    });
    expect(String(res.stdout)).toContain("variable");
    // Nothing was removed, so the preview must not say it was.
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
      "variable",
      "rm",
      "SUPPORT_EMAIL",
      "--non-interactive",
      ...base(cwd),
    ]);

    expect(res.exitCode).not.toBe(0);
    expect(called).toBe(false);
    const json = parseJson(res.stdout) as {
      code: string;
      hint: string;
      next_commands: string[];
    };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.next_commands.join(" ")).toContain("--force");
    expect(json.hint).toContain("from the project");
  });
});

describe("variable set value argument and --preview", () => {
  it("sends a plain value given on the command line, piping nothing", async () => {
    const cwd = await makeProject();
    let body: Record<string, unknown> = {};
    server.use(
      http.patch("*/variables", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest([
      "variable",
      "set",
      "API_URL",
      "https://acme.com",
      ...base(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(body).toEqual({ API_URL: { value: "https://acme.com", secret: false } });
  });

  it("refuses a value on the command line for a secret, reading nothing", async () => {
    const cwd = await makeProject();
    let called = false;
    server.use(
      http.patch("*/variables", () => {
        called = true;
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest([
      "variable",
      "set",
      "TOKEN",
      "s3cret",
      "--secret",
      ...base(cwd),
    ]);

    expect(res.exitCode).not.toBe(0);
    expect(called).toBe(false);
    const json = parseJson(res.stdout) as { code: string };
    expect(json.code).toBe("E_VALIDATION");
  });

  it("writes the preview override under --preview", async () => {
    const cwd = await makeProject();
    let appliesTo: string | null = "unset";
    server.use(
      http.patch("*/variables", ({ request }) => {
        appliesTo = new URL(request.url).searchParams.get("applies_to");
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest([
      "variable",
      "set",
      "API_URL",
      "https://preview.acme.com",
      "--preview",
      ...base(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(appliesTo).toBe("preview");
    const json = parseJson(res.stdout) as { data: { applies_to: string } };
    expect(json.data.applies_to).toBe("preview");
  });

  it("keeps --preview in the retry it suggests when nothing is piped in", async () => {
    const cwd = await makeProject();
    // A terminal on stdin is what triggers the retry rather than a blocking read.
    const original = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", { value: { isTTY: true }, configurable: true });
    try {
      const res = await runCliForTest([
        "variable",
        "set",
        "API_URL",
        "--preview",
        "--non-interactive",
        ...base(cwd),
      ]);

      expect(res.exitCode).not.toBe(0);
      const json = parseJson(res.stdout) as { next_commands: string[] };
      expect(json.next_commands.join(" ")).toContain("--preview");
    } finally {
      if (original) {
        Object.defineProperty(process, "stdin", original);
      }
    }
  });
});

describe("variable resolve", () => {
  const live = (deployments: unknown[]) =>
    http.get("*/deployments", () => HttpResponse.json({ deployments }));

  it("is a miss when nothing is deployed", async () => {
    const cwd = await makeProject();
    server.use(live([]));

    const res = await runCliForTest(["variable", "resolve", ...base(cwd)]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { code: string };
    expect(json.code).toBe("E_NOT_FOUND");
  });

  it("reads the frozen map of the newest live deployment", async () => {
    const cwd = await makeProject();
    server.use(
      live([{ id: "dep_1", targets: [{ origin: "https://app.acme.com" }] }]),
      http.get("*/deployments/:id/variables", ({ params }) => {
        expect(String(params.id)).toBe("dep_1");
        return HttpResponse.json({ API_URL: "https://api.acme.com", TOKEN: { secret: true } });
      }),
    );

    const res = await runCliForTest(["variable", "resolve", ...base(cwd)]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      data: { deployment_id: string; variables: Array<Record<string, unknown>> };
    };
    expect(json.data.deployment_id).toBe("dep_1");
    expect(json.data.variables).toEqual([
      { name: "API_URL", secret: false, value: "https://api.acme.com" },
      { name: "TOKEN", secret: true },
    ]);
  });

  it("asks the server only for the named origin's live deployment", async () => {
    const cwd = await makeProject();
    let origin: string | null = "unset";
    server.use(
      http.get("*/deployments", ({ request }) => {
        origin = new URL(request.url).searchParams.get("origin");
        return HttpResponse.json({ deployments: [{ id: "dep_2", targets: [] }] });
      }),
      http.get("*/deployments/:id/variables", () => HttpResponse.json({})),
    );

    const res = await runCliForTest([
      "variable",
      "resolve",
      "--origin",
      "https://app.acme.com",
      ...base(cwd),
    ]);

    expect(res.exitCode).toBe(0);
    expect(origin).toBe("https://app.acme.com");
  });
});

describe("variable list no longer accepts --environment", () => {
  it("rejects --environment, which named an environment", async () => {
    const cwd = await makeProject();

    const res = await runCliForTest(["variable", "list", "--environment", "prod", ...base(cwd)]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { code: string; message: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("Nonexistent flag");
  });
});
