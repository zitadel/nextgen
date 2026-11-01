import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../helpers/clack")).clackDouble());

import { cancel, confirm, isCancel, text } from "@clack/prompts";

import VariableRm from "../../../src/commands/variable/rm";
import VariableSet from "../../../src/commands/variable/set";
import { DEFAULT_SERVER } from "../../../src/lib/server";
import { usePlatformServer } from "../../helpers/platform-project";
import { parseJson, runCliForTest } from "../../helpers/run-cli";
import { asTerminal as asPerson } from "../../helpers/terminal";

const { server } = usePlatformServer();

async function makeProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-variables-"));
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify({
      project_id: "proj_test",
      project_secret: "sk_proj_test_full",
      preview_secret: "sk_proj_test_preview",
      primary_origins: [],
      preview_origins: [],
      created_at: "2026-01-01T00:00:00Z",
    }),
  );
  return cwd;
}

const base = (cwd: string) => ["--cwd", cwd, "--json", "--server", DEFAULT_SERVER];

/** Writes a `zitadel.json`, for the runs that exercise server resolution. */
async function writeConfig(cwd: string, config: unknown): Promise<void> {
  await writeFile(join(cwd, "zitadel.json"), JSON.stringify(config), "utf8");
}

/** The plain rendering: no `--json`. */
const plainArgs = (cwd: string) => ["--cwd", cwd, "--server", DEFAULT_SERVER, "--non-interactive"];

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
          GOOGLE_CLIENT_SECRET: { primary: { secret: true } },
          GOOGLE_CLIENT_ID: { primary: "999-prod", preview: "999-test" },
          PREVIEW_ONLY: { preview: "x" },
        }),
      ),
    );

    const res = await runCliForTest(["variable", "list", ...base(cwd)]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: {
        count: number;
        next_page_token: string | null;
        items: Array<Record<string, unknown>>;
      };
    };
    expect(json.status).toBe("ok");
    expect(json.data.count).toBe(3);
    expect(json.data.next_page_token).toBeNull();
    expect(json.data.items).toEqual([
      {
        name: "GOOGLE_CLIENT_ID",
        secret: false,
        value: "999-prod",
        preview: { secret: false, value: "999-test" },
      },
      { name: "GOOGLE_CLIENT_SECRET", secret: true },
      { name: "PREVIEW_ONLY", secret: false, preview: { secret: false, value: "x" } },
    ]);
    // One owner, so the envelope states none: a permanent `null` would read as
    // a value the run could have chosen.
    expect(json.data).not.toHaveProperty("environment");
  });

  it("never emits a value key for a secret", async () => {
    const cwd = await makeProject();
    server.use(
      http.get("*/variables", () => HttpResponse.json({ S: { primary: { secret: true } } })),
    );

    const res = await runCliForTest(["variable", "list", ...base(cwd)]);

    const json = parseJson(res.stdout) as { data: { items: Array<Record<string, unknown>> } };
    expect(json.data.items[0]).not.toHaveProperty("value");
  });

  it("reads both kinds for the inventory, naming no kind", async () => {
    const cwd = await makeProject();
    let seen: string | null = "unset";
    server.use(
      http.get("*/variables", ({ request }) => {
        seen = new URL(request.url).searchParams.get("kind");
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest(["variable", "list", ...base(cwd)]);

    expect(res.exitCode).toBe(0);
    expect(seen).toBeNull();
    const json = parseJson(res.stdout) as { data: { count: number } };
    expect(json.data.count).toBe(0);
  });

  it("reads the preview values under --preview", async () => {
    const cwd = await makeProject();
    let kind: string | null = "unset";
    server.use(
      http.get("*/variables", ({ request }) => {
        kind = new URL(request.url).searchParams.get("kind");
        return HttpResponse.json({ API_URL: { preview: "https://preview.acme.com" } });
      }),
    );

    const res = await runCliForTest(["variable", "list", "--preview", ...base(cwd)]);

    expect(kind).toBe("preview");
    expect((parseJson(res.stdout) as { data: { items: unknown[] } }).data.items).toEqual([
      { name: "API_URL", secret: false, value: "https://preview.acme.com" },
    ]);
  });

  it("prints tab-separated rows with no header on a pipe, and nothing when empty", async () => {
    const cwd = await makeProject();
    let call = 0;
    server.use(
      http.get("*/variables", () =>
        HttpResponse.json(
          call++ === 0 ? { B: { primary: "two" }, A: { primary: { secret: true } } } : {},
        ),
      ),
    );

    const rows = await runCliForTest(["variable", "list", ...plainArgs(cwd)]);
    const empty = await runCliForTest(["variable", "list", ...plainArgs(cwd)]);

    expect(rows.exitCode).toBe(0);
    expect(rows.stdout.trim().split("\n")).toEqual(["A\t(secret)\t-", "B\ttwo\t-"]);
    expect(empty.exitCode).toBe(0);
    expect(empty.stdout.trim()).toBe("");
  });

  it("renders a table and a count on a terminal, unless --plain", async () => {
    const cwd = await makeProject();
    server.use(
      http.get("*/variables", () => HttpResponse.json({ V: { primary: "one\ntwo\u001b[31m" } })),
    );

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
    server.use(http.get("*/variables", () => HttpResponse.json({ A: { primary: "b" } })));

    // The harness captures stdout, so process.stdout.isTTY is undefined here —
    // the same condition a pipe or a redirect creates.
    const piped = await runCliForTest(["variable", "list", ...plainArgs(cwd)]);
    const terminal = await asTerminal(() => runCliForTest(["variable", "list", ...plainArgs(cwd)]));

    expect(piped.exitCode).toBe(0);
    expect(piped.stdout).not.toContain("Project   ");
    expect(piped.stdout).not.toContain("Server    ");
    expect(piped.stdout.trim()).toBe("A\tb\t-");
    expect(terminal.stdout).toContain("proj_test");
    expect(terminal.stdout).toContain(DEFAULT_SERVER);
  });

  it("takes the server from ZITADEL_URL, not from zitadel.json", async () => {
    const cwd = await makeProject();
    await writeConfig(cwd, { project: "proj_test", server: "https://elsewhere.example" });
    await writeFile(join(cwd, ".env.local"), `ZITADEL_URL=${DEFAULT_SERVER}\n`);
    let hit = "";
    server.use(
      http.get("*/variables", ({ request }) => {
        hit = new URL(request.url).origin;
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest(["variable", "list", "--cwd", cwd, "--json"]);

    expect(res.exitCode).toBe(0);
    expect(hit).toBe(DEFAULT_SERVER);
  });
});

describe("variable get", () => {
  it("returns a non-secret value, addressing the project level", async () => {
    const cwd = await makeProject();
    let path = "";
    let kind: string | null = "unset";
    server.use(
      http.get("*/variables/:name", ({ request, params }) => {
        path = String(params.name);
        kind = new URL(request.url).searchParams.get("kind");
        return HttpResponse.json({ primary: "999-prod" });
      }),
    );

    const res = await runCliForTest(["variable", "get", "GOOGLE_CLIENT_ID", ...base(cwd)]);

    expect(res.exitCode).toBe(0);
    expect(path).toBe("GOOGLE_CLIENT_ID");
    expect(kind).toBe("primary");
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
    server.use(http.get("*/variables/:name", () => HttpResponse.json({ primary: "999-prod" })));

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
    server.use(
      http.get("*/variables/:name", () => HttpResponse.json({ primary: { secret: true } })),
    );

    const res = await runCliForTest(["variable", "get", "TOKEN", ...plainArgs(cwd)]);

    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ name: "TOKEN", secret: true });
  });

  it("lays the record out field by field on a terminal", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables/:name", () => HttpResponse.json({ primary: "999-prod" })));

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
        HttpResponse.json({ primary: params.name === "TOKEN" ? { secret: true } : "" }),
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

  it("fails with E_NOT_FOUND when the answer has no primary value", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables/:name", () => HttpResponse.json({ preview: "x" })));

    const res = await runCliForTest(["variable", "get", "TOKEN", ...base(cwd)]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { code: string; message: string };
    expect(json.code).toBe("E_NOT_FOUND");
    expect(json.message).toContain("TOKEN has no primary value");
  });

  it("reads the preview value under --preview, and misses a name that has none", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables/:name", () => HttpResponse.json({ primary: "x" })));

    const res = await runCliForTest(["variable", "get", "TOKEN", "--preview", ...base(cwd)]);

    expect((parseJson(res.stdout) as { message: string }).message).toContain(
      "TOKEN has no preview value",
    );
  });

  it("reports a secret as held and carries no value", async () => {
    const cwd = await makeProject();
    server.use(
      http.get("*/variables/:name", () => HttpResponse.json({ primary: { secret: true } })),
    );

    const res = await runCliForTest(["variable", "get", "TOKEN", ...base(cwd)]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: Record<string, unknown> };
    expect(json.data.secret).toBe(true);
    expect(json.data).not.toHaveProperty("value");
  });

  it("escapes a value that would otherwise drive the terminal", async () => {
    const cwd = await makeProject();
    server.use(http.get("*/variables/:name", () => HttpResponse.json({ primary: "a\u001b[31mb" })));

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
    let kind: string | null = "unset";
    server.use(
      http.patch("*/variables", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        kind = new URL(request.url).searchParams.get("kind");
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
    expect(kind).toBeNull();
    expect(body).toEqual({ GOOGLE_CLIENT_SECRET: { value: "GOCSPX-abc", secret: true } });
    const json = parseJson(res.stdout) as { data: Record<string, unknown> };
    // A secret is stored for the primary kind only, as the platform's rule has
    // it; the state is read back in the response (see the stored-state test), so
    // this only checks what the write asked for.
    expect(json.data).toMatchObject({
      name: "GOOGLE_CLIENT_SECRET",
      type: "string",
      kinds: ["primary"],
    });
  });

  it("reports both kinds' state read back from the store, never a secret's value", async () => {
    // The output reflects what the store holds after the write, not the request
    // flags: here the real mock persists, so the primary kind reports the secret
    // as held with no value, and the preview kind reports not set.
    const cwd = await makeProject();

    const res = await withStdin("GOCSPX-abc", () =>
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
    expect(res.stdout).not.toContain("GOCSPX-abc");
    const json = parseJson(res.stdout) as {
      data: { primary: Record<string, unknown>; preview: Record<string, unknown> };
    };
    expect(json.data.primary).toEqual({ held: true, secret: true });
    expect(json.data.primary).not.toHaveProperty("value");
    expect(json.data.preview).toEqual({ held: false });
  });

  it("says on a terminal what each kind holds after the write", async () => {
    // Real mock, so the read-back after the write is honest: a plain value is
    // stored for both kinds, a secret prints its marker for the primary kind
    // alone, and a kind with no value prints `(not set)`.
    const cwd = await makeProject();

    const plain = await asTerminal(() =>
      withStdin("hello", () => runCliForTest(["variable", "set", "GREETING", ...plainArgs(cwd)])),
    );
    const secret = await asTerminal(() =>
      withStdin("v", () =>
        runCliForTest(["variable", "set", "TOKEN", "--secret", ...plainArgs(cwd)]),
      ),
    );

    expect(plain.stdout).toContain("Set GREETING on the project");
    expect(plain.stdout).toMatch(/primary\s+hello/);
    expect(plain.stdout).toMatch(/preview\s+hello/);
    expect(secret.stdout).toContain("Set TOKEN on the project");
    expect(secret.stdout).toMatch(/primary\s+\(secret\)/);
    expect(secret.stdout).toMatch(/preview\s+\(not set\)/);
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
      expect(json.hint).toContain("Pipe it in on stdin");
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
      expect(json.hint).toContain("Pipe it in on stdin.");
      // The server this run was pointed at, before the redirection: without
      // it the piped secret would land in the default project's store.
      expect(retry).toContain(`--server ${DEFAULT_SERVER}`);
      expect(retry.endsWith(" < value.txt")).toBe(true);
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
      type: "string",
    });
    expect(json.data).not.toHaveProperty("value");
    expect(json.data).not.toHaveProperty("environment");
  });

  it("refuses a plain preview value for a name whose value is a secret", async () => {
    const cwd = await makeProject();
    server.use(
      http.get("*/variables", () =>
        HttpResponse.json({ GOOGLE_CLIENT_SECRET: { primary: { secret: true } } }),
      ),
    );

    const res = await runCliForTest([
      "variable",
      "set",
      "GOOGLE_CLIENT_SECRET",
      "hunter2",
      "--preview",
      ...base(cwd),
    ]);

    const json = parseJson(res.stdout) as { code: string; next_commands?: string[] };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.next_commands?.[0]).toContain(
      "variable set GOOGLE_CLIENT_SECRET --secret --preview",
    );
  });

  it("refuses a given value its --as cannot parse under --dry-run, as the real run does", async () => {
    const cwd = await makeProject();

    const res = await runCliForTest([
      "variable",
      "set",
      "SESSION_TTL",
      "abc",
      "--as",
      "number",
      "--dry-run",
      ...base(cwd),
    ]);

    expect((parseJson(res.stdout) as { code: string }).code).toBe("E_VALIDATION");
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

  it("says what is wrong with the value and how to write it", async () => {
    const cwd = await makeProject();

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

    const json = parseJson(res.stdout) as { message: string };
    expect(json.message).toMatch(/Expected a number.*JSON number/);
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

      const json = parseJson(res.stdout) as { next_commands: string[]; hint: string };
      expect(json.next_commands.join(" ")).toContain("--as number");
    } finally {
      if (original) {
        Object.defineProperty(process, "stdin", original);
      }
    }
  });
});

describe("variable rm asked on a terminal", () => {
  // The built CLI bundles its own prompts, so a prompt can only be answered
  // by running the command from source, where `input` is the one module asked.
  const removing = (cwd: string) =>
    asPerson(() => VariableRm.run(["SUPPORT_EMAIL", "--cwd", cwd, "--server", DEFAULT_SERVER]));
  const watchingDeletes = () => {
    const seen = { deleted: false };
    server.use(
      http.delete("*/variables/:name", () => {
        seen.deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    return seen;
  };

  afterEach(() => {
    vi.mocked(confirm).mockReset();
    vi.mocked(isCancel).mockReset();
    vi.mocked(isCancel).mockReturnValue(false);
  });

  it("is skipped, removing nothing, when the answer is no", async () => {
    const cwd = await makeProject();
    const seen = watchingDeletes();
    vi.mocked(confirm).mockResolvedValueOnce(false as never);

    const envelope = await removing(cwd);

    expect(JSON.parse(JSON.stringify(envelope))).toMatchObject({
      status: "skipped",
      reason: "remove-cancelled",
    });
    expect(seen.deleted).toBe(false);
  });

  it("fails, removing nothing, on Ctrl-C", async () => {
    const cwd = await makeProject();
    const seen = watchingDeletes();
    vi.mocked(isCancel).mockReturnValue(true);
    vi.mocked(confirm).mockResolvedValueOnce(Symbol("cancel") as never);

    await expect(removing(cwd)).rejects.toThrow();

    expect(cancel).toHaveBeenCalledWith("Cancelled.");
    expect(seen.deleted).toBe(false);
  });
});

describe("variable set asked on a terminal", () => {
  it("asks what the value should be, as a question", async () => {
    const cwd = await makeProject();
    vi.mocked(text).mockResolvedValueOnce("support@acme.example" as never);

    await asPerson(() =>
      VariableSet.run(["SUPPORT_EMAIL", "--cwd", cwd, "--server", DEFAULT_SERVER]),
    ).catch(() => undefined);

    expect(vi.mocked(text).mock.calls[0]?.[0].message).toBe(
      "What should the value of SUPPORT_EMAIL be?",
    );
  });
});

describe("variable rm", () => {
  it("keeps the run's server in the suggested --force retry", async () => {
    const cwd = await makeProject();

    const res = await runCliForTest([
      "variable",
      "rm",
      "SUPPORT_EMAIL",
      "--non-interactive",
      ...base(cwd),
    ]);

    const json = parseJson(res.stdout) as { next_commands?: string[] };
    expect(json.next_commands?.[0]).toContain(
      `variable rm SUPPORT_EMAIL --force --server ${DEFAULT_SERVER}`,
    );
  });

  it("keeps --preview in the suggested --force retry, so it removes the override", async () => {
    const cwd = await makeProject();

    const res = await runCliForTest([
      "variable",
      "rm",
      "SUPPORT_EMAIL",
      "--preview",
      "--non-interactive",
      ...base(cwd),
    ]);

    const json = parseJson(res.stdout) as { next_commands?: string[] };
    expect(json.next_commands?.[0]).toContain("variable rm SUPPORT_EMAIL --preview --force");
  });

  it("deletes the name at the project level", async () => {
    const cwd = await makeProject();
    let path = "";
    let kind: string | null = "unset";
    server.use(
      http.delete("*/variables/:name", ({ request, params }) => {
        path = String(params.name);
        kind = new URL(request.url).searchParams.get("kind");
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
    expect(kind).toBeNull();
    const json = parseJson(res.stdout) as { data: Record<string, unknown> };
    expect(json.data).toEqual({
      name: "SUPPORT_EMAIL",
      deleted: true,
      kinds: ["primary", "preview"],
    });
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

  it("writes the preview value alone under --preview", async () => {
    const cwd = await makeProject();
    let kind: string | null = "unset";
    server.use(
      http.patch("*/variables", ({ request }) => {
        kind = new URL(request.url).searchParams.get("kind");
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
    expect(kind).toBe("preview");
    const json = parseJson(res.stdout) as { data: { kinds: string[] } };
    expect(json.data.kinds).toEqual(["preview"]);
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
      data: { deployment_id: string; origins: string[]; items: Array<Record<string, unknown>> };
    };
    expect(json.data.deployment_id).toBe("dep_1");
    // The chosen origin is named in the output, so a bare resolve says which
    // target the frozen map runs on (#1617).
    expect(json.data.origins).toEqual(["https://app.acme.com"]);
    expect(json.data.items).toEqual([
      { name: "API_URL", secret: false, value: "https://api.acme.com" },
      { name: "TOKEN", secret: true },
    ]);
  });

  it("refuses to guess when more than one deployment is live and no origin is given", async () => {
    // Two deployments live on different origins have no single frozen map, so a
    // bare resolve names the live origins and asks for --origin rather than
    // reading an arbitrary one (#1617).
    const cwd = await makeProject();
    let variablesRequested = false;
    server.use(
      live([
        { id: "dep_a", targets: [{ origin: "https://app.acme.com" }] },
        { id: "dep_b", targets: [{ origin: "https://admin.acme.com" }] },
      ]),
      http.get("*/deployments/:id/variables", () => {
        variablesRequested = true;
        return HttpResponse.json({});
      }),
    );

    const res = await runCliForTest(["variable", "resolve", ...base(cwd)]);

    expect(res.exitCode).not.toBe(0);
    expect(variablesRequested).toBe(false);
    const json = parseJson(res.stdout) as { code: string; hint: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.hint).toContain("https://app.acme.com");
    expect(json.hint).toContain("https://admin.acme.com");
  });

  it("names the live origins of every page when more than one deployment is live", async () => {
    const cwd = await makeProject();
    server.use(
      http.get("*/deployments", ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get("page_token") === "p2"
            ? {
                deployments: [{ id: "dep_b", targets: [{ origin: "https://admin.acme.com" }] }],
                next_page_token: null,
              }
            : {
                deployments: [{ id: "dep_a", targets: [{ origin: "https://app.acme.com" }] }],
                next_page_token: "p2",
              },
        ),
      ),
    );

    const res = await runCliForTest(["variable", "resolve", ...base(cwd)]);

    expect(parseJson(res.stdout)).toMatchObject({
      code: "E_VALIDATION",
      hint: "Live origins: https://admin.acme.com, https://app.acme.com.",
    });
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
