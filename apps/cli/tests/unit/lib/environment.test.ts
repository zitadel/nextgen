import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readBoundEnvironments,
  requireValue,
  requireValueInteractive,
  resolveEnvironment,
} from "../../../src/lib/environment";
import type { Questions } from "../../../src/lib/ui";

/** The answer the mocked clack prompt returns; set per test. */
const promptAnswer: { value: string | symbol } = { value: "" };
vi.mock("@clack/prompts", () => ({
  text: vi.fn(async () => promptAnswer.value),
  password: vi.fn(async () => promptAnswer.value),
  isCancel: (value: unknown) => typeof value === "symbol",
  cancel: vi.fn(),
}));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-environment-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function dotenv(values: Record<string, string>): string {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

async function write(file: string, values: Record<string, string>): Promise<void> {
  await writeFile(join(dir, file), dotenv(values));
}

async function writeSecret(): Promise<void> {
  await mkdir(join(dir, ".zitadel"), { recursive: true });
  await writeFile(
    join(dir, ".zitadel/secret"),
    JSON.stringify({
      project_id: "proj_secret_file",
      project_secret: "sk_secret_file",
      preview_secret: "sk_preview_file",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    }),
  );
}

const resolve = (input: Partial<Parameters<typeof resolveEnvironment>[0]> = {}) =>
  resolveEnvironment({ cwd: dir, env: {}, ...input });

describe("resolveEnvironment", () => {
  describe("the environment's name", () => {
    it("is development by default", async () => {
      expect((await resolve()).name).toEqual({ value: "development", source: "default" });
    });

    it("prefers --env to everything else", async () => {
      const environment = await resolve({
        envName: "staging",
        env: { ZITADEL_ENV: "production", VERCEL_ENV: "preview" },
      });

      expect(environment.name).toEqual({ value: "staging", source: "--env" });
    });

    it("reads ZITADEL_ENV before a platform's signal", async () => {
      const environment = await resolve({
        env: { ZITADEL_ENV: "production", VERCEL_ENV: "preview" },
      });

      expect(environment.name).toEqual({ value: "production", source: "ZITADEL_ENV" });
    });

    it("ignores a CONTEXT that no Netlify build set", async () => {
      expect((await resolve({ env: { CONTEXT: "staging" } })).name).toEqual({
        value: "development",
        source: "default",
      });
    });

    it("reads VERCEL_ENV", async () => {
      expect((await resolve({ env: { VERCEL_ENV: "production" } })).name).toEqual({
        value: "production",
        source: "VERCEL_ENV",
      });
    });

    it.each([
      ["deploy-preview", "preview"],
      ["branch-deploy", "preview"],
      ["dev", "development"],
      ["production", "production"],
    ])("reads CONTEXT=%s as %s", async (context, name) => {
      expect((await resolve({ env: { CONTEXT: context, NETLIFY: "true" } })).name).toEqual({
        value: name,
        source: "CONTEXT",
      });
    });

    it("ignores NODE_ENV, which platforms set to production for every build", async () => {
      expect((await resolve({ env: { NODE_ENV: "production" } })).name.value).toBe("development");
    });
  });

  describe("the chain", () => {
    it("takes --server over every other source", async () => {
      await write(".env.development.local", { ZITADEL_URL: "https://file.example" });

      const environment = await resolve({
        serverFlag: "https://flag.example",
        env: { ZITADEL_URL: "https://process.example" },
      });

      expect(environment.values.ZITADEL_URL).toEqual({
        value: "https://flag.example",
        source: "--server",
      });
    });

    it("takes the values of --env-file over the process environment", async () => {
      const file = join(dir, "staging.env");
      await writeFile(file, dotenv({ ZITADEL_PROJECT_ID: "proj_file" }));

      const environment = await resolve({
        envFile: file,
        env: { ZITADEL_PROJECT_ID: "proj_process" },
      });

      expect(environment.values.ZITADEL_PROJECT_ID?.value).toBe("proj_file");
    });

    it("reads a relative --env-file from the working directory", async () => {
      await write("staging.env", { ZITADEL_PROJECT_ID: "proj_file" });

      const environment = await resolve({ envFile: "staging.env" });

      expect(environment.values.ZITADEL_PROJECT_ID?.value).toBe("proj_file");
    });

    it("takes the process environment over every .env file", async () => {
      await write(".env.development.local", { ZITADEL_PROJECT_ID: "proj_file" });

      const environment = await resolve({ env: { ZITADEL_PROJECT_ID: "proj_process" } });

      expect(environment.values.ZITADEL_PROJECT_ID).toEqual({
        value: "proj_process",
        source: "process environment",
      });
    });

    it("walks .env.<env>.local, .env.local, .env.<env>, .env in that order", async () => {
      await write(".env", { ZITADEL_PROJECT_ID: "from-env" });
      await write(".env.development", { ZITADEL_PROJECT_ID: "from-env-development" });
      await write(".env.local", { ZITADEL_PROJECT_ID: "from-env-local" });
      await write(".env.development.local", { ZITADEL_PROJECT_ID: "from-env-development-local" });
      const order: string[] = [];

      for (const file of [".env.development.local", ".env.local", ".env.development", ".env"]) {
        order.push((await resolve()).values.ZITADEL_PROJECT_ID?.source ?? "");
        await rm(join(dir, file));
      }

      expect(order).toEqual([".env.development.local", ".env.local", ".env.development", ".env"]);
    });

    it("skips .env.local for the test environment", async () => {
      await write(".env.local", { ZITADEL_PROJECT_ID: "from-env-local" });
      await write(".env.test", { ZITADEL_PROJECT_ID: "from-env-test" });

      const environment = await resolve({ envName: "test" });

      expect(environment.values.ZITADEL_PROJECT_ID?.source).toBe(".env.test");
    });

    it("never takes another environment's project from .env.local", async () => {
      await write(".env.local", { ZITADEL_PROJECT_ID: "proj_development" });

      const environment = await resolve({ envName: "production" });

      expect(environment.values.ZITADEL_PROJECT_ID).toBeUndefined();
    });

    it("never takes another environment's credential from .zitadel/secret", async () => {
      await writeSecret();

      const environment = await resolve({ envName: "production" });

      expect(environment.values.ZITADEL_PROJECT_SECRET).toBeUndefined();
    });

    it("never fills an --env-file's gaps from .env.local", async () => {
      await write("ci.env", { ZITADEL_PROJECT_ID: "proj_ci" });
      await write(".env.local", { ZITADEL_URL: "https://dev.example" });

      const environment = await resolve({ envFile: "ci.env" });

      expect(environment.values.ZITADEL_URL).toBeUndefined();
    });

    it("never fills an --env-file's gaps from .zitadel/secret", async () => {
      await write("ci.env", { ZITADEL_PROJECT_ID: "proj_ci" });
      await writeSecret();

      const environment = await resolve({ envFile: "ci.env" });

      expect(environment.values.ZITADEL_PROJECT_SECRET).toBeUndefined();
    });

    it("never fills an --env-file's gaps from .env.development.local", async () => {
      await write("prod.env", { ZITADEL_URL: "https://prod.example" });
      await write(".env.development.local", { ZITADEL_PROJECT_SECRET: "sk_development" });

      const environment = await resolve({ envFile: "prod.env" });

      expect(environment.values.ZITADEL_PROJECT_SECRET).toBeUndefined();
    });

    it("falls back to .zitadel/secret for the project and its credentials", async () => {
      await writeSecret();

      const { values } = await resolve();

      expect(values).toMatchObject({
        ZITADEL_PROJECT_ID: { value: "proj_secret_file", source: ".zitadel/secret" },
        ZITADEL_PROJECT_SECRET: { value: "sk_secret_file", source: ".zitadel/secret" },
        ZITADEL_PREVIEW_TOKEN: { value: "sk_preview_file", source: ".zitadel/secret" },
      });
    });

    it("prefers a file in the chain to .zitadel/secret", async () => {
      await writeSecret();
      await write(".env.development.local", { ZITADEL_PROJECT_ID: "proj_file" });

      const { values } = await resolve();

      expect(values.ZITADEL_PROJECT_ID?.value).toBe("proj_file");
    });

    it("resolves each value on its own", async () => {
      await write(".env.development.local", { ZITADEL_PROJECT_ID: "proj_file" });
      await write(".env", { ZITADEL_URL: "https://dotenv.example" });

      const { values } = await resolve({ env: { ZITADEL_PROJECT_SECRET: "sk_process" } });

      expect(
        Object.fromEntries(Object.entries(values).map(([key, entry]) => [key, entry.source])),
      ).toEqual({
        ZITADEL_PROJECT_ID: ".env.development.local",
        ZITADEL_URL: ".env",
        ZITADEL_PROJECT_SECRET: "process environment",
      });
    });

    it("never takes ZITADEL_API_BASE or the server in zitadel.json", async () => {
      await writeFile(
        join(dir, "zitadel.json"),
        JSON.stringify({ server: "https://config.example" }),
      );

      const { values } = await resolve({ env: { ZITADEL_API_BASE: "https://base.example" } });

      expect(values.ZITADEL_URL).toBeUndefined();
    });

    it("normalises the server to its origin", async () => {
      await write(".env.development.local", { ZITADEL_URL: "https://file.example/some/path" });

      expect((await resolve()).values.ZITADEL_URL?.value).toBe("https://file.example");
    });

    it("refuses a server that is not an http(s) URL", async () => {
      await write(".env.development.local", { ZITADEL_URL: "ftp://file.example" });

      await expect(resolve()).rejects.toMatchObject({ code: "E_VALIDATION" });
    });

    it("names the file a malformed server came from", async () => {
      await write(".env", { ZITADEL_URL: "localhost:8080" });

      await expect(resolve()).rejects.toMatchObject({
        message: expect.stringContaining("ZITADEL_URL from .env"),
      });
    });

    it("ignores an empty value", async () => {
      await write(".env.development.local", { ZITADEL_PROJECT_ID: "" });
      await write(".env", { ZITADEL_PROJECT_ID: "proj_dotenv" });

      expect((await resolve()).values.ZITADEL_PROJECT_ID?.source).toBe(".env");
    });
  });

  describe("what it refuses", () => {
    it("refuses --env together with --env-file", async () => {
      await write("staging.env", { ZITADEL_PROJECT_ID: "proj_file" });

      await expect(resolve({ envName: "staging", envFile: "staging.env" })).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining("--env-file"),
      });
    });

    it("refuses an --env-file that does not exist", async () => {
      await expect(resolve({ envFile: "missing.env" })).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining("missing.env"),
      });
    });

    it("refuses an environment name that would escape the project directory", async () => {
      await expect(resolve({ envName: "../evil" })).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining("valid environment name"),
      });
      await expect(resolve({ env: { ZITADEL_ENV: "a/b" } })).rejects.toMatchObject({
        code: "E_VALIDATION",
      });
      await expect(resolve({ envName: "a..b" })).rejects.toMatchObject({ code: "E_VALIDATION" });
    });

    it.each(["local", "staging.local"])(
      "refuses %s, whose files are another environment's",
      async (name) => {
        await expect(resolve({ envName: name })).rejects.toMatchObject({ code: "E_VALIDATION" });
      },
    );

    it("accepts a name of letters, digits, dot, dash and underscore", async () => {
      for (const name of ["staging", "preview-1", "feature.branch", "env_2"]) {
        expect((await resolve({ envName: name })).name.value).toBe(name);
      }
    });
  });

  describe("what it reports", () => {
    it("lists every source it looked in, in order, with what each supplied", async () => {
      await write(".env.development.local", { ZITADEL_PROJECT_ID: "proj_file" });

      const { consulted } = await resolve();

      expect(consulted).toEqual([
        { source: "--server", present: false, supplied: [] },
        { source: "process environment", present: true, supplied: [] },
        { source: ".env.development.local", present: true, supplied: ["ZITADEL_PROJECT_ID"] },
        { source: ".env.local", present: false, supplied: [] },
        { source: ".env.development", present: false, supplied: [] },
        { source: ".env", present: false, supplied: [] },
        { source: ".zitadel/secret", present: false, supplied: [] },
      ]);
    });

    it("lists the --env-file between --server and the process environment", async () => {
      await write("staging.env", { ZITADEL_PROJECT_ID: "proj_file" });

      const { consulted } = await resolve({ envFile: "staging.env" });

      expect(consulted.slice(0, 3).map((entry) => entry.source)).toEqual([
        "--server",
        "--env-file staging.env",
        "process environment",
      ]);
    });
  });
});

describe("requireValue", () => {
  it("names the environment, the variable and every source consulted", async () => {
    const environment = await resolve({ envName: "production" });

    let thrown: unknown;
    try {
      requireValue(environment, "ZITADEL_PROJECT_ID");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "E_VALIDATION" });
    expect((thrown as Error).message).toBe(
      "ZITADEL_PROJECT_ID is not set for the production environment",
    );
    const { hint } = thrown as { hint: string };
    for (const source of [
      "process environment",
      ".env.production.local",
      ".env.production",
      ".env",
    ]) {
      expect(hint).toContain(source);
    }
  });

  it("points a development environment at setup and any other at env add", async () => {
    const development = await resolve();
    const production = await resolve({ envName: "production" });

    expect(() => requireValue(development, "ZITADEL_URL")).toThrow(
      expect.objectContaining({ nextCommands: [`zitadel setup --cwd ${dir}`] }),
    );
    expect(() => requireValue(production, "ZITADEL_URL")).toThrow(
      expect.objectContaining({ nextCommands: [`zitadel env add production --cwd ${dir}`] }),
    );
  });

  it("points an --env-file run at that file", async () => {
    await write("ci.env", { ZITADEL_URL: "https://ci.example" });
    const environment = await resolve({ envFile: "ci.env" });

    expect(() => requireValue(environment, "ZITADEL_PROJECT_ID")).toThrow(
      expect.objectContaining({
        hint: expect.stringContaining("Set ZITADEL_PROJECT_ID in ci.env"),
      }),
    );
  });

  it("never sends an --env-file run to setup, which would create a new project", async () => {
    await write("ci.env", { ZITADEL_URL: "https://ci.example" });
    const environment = await resolve({ envFile: "ci.env" });

    expect(() => requireValue(environment, "ZITADEL_PROJECT_ID")).toThrow(
      expect.objectContaining({ nextCommands: undefined }),
    );
  });

  it("points an environment env add already bound at its own file", async () => {
    await write(".env.production.local", { ZITADEL_PROJECT_ID: "proj_production" });
    const environment = await resolve({ envName: "production" });

    expect(() => requireValue(environment, "ZITADEL_PROJECT_SECRET")).toThrow(
      expect.objectContaining({
        hint: expect.stringContaining("Set ZITADEL_PROJECT_SECRET in .env.production.local"),
        nextCommands: undefined,
      }),
    );
  });

  it("sends no one to env add when the process environment already names the project", async () => {
    const environment = await resolve({
      envName: "production",
      env: { ZITADEL_PROJECT_ID: "proj_ci" },
    });

    expect(() => requireValue(environment, "ZITADEL_PROJECT_SECRET")).toThrow(
      expect.objectContaining({ nextCommands: undefined }),
    );
  });

  it("runs the env add it suggests in the directory this run addressed", async () => {
    const environment = await resolve({ envName: "staging" });

    expect(() => requireValue(environment, "ZITADEL_PROJECT_ID")).toThrow(
      expect.objectContaining({ nextCommands: [`zitadel env add staging --cwd ${dir}`] }),
    );
  });

  it("returns the value when it resolved", async () => {
    await write(".env.development.local", { ZITADEL_PROJECT_ID: "proj_file" });

    expect(requireValue(await resolve(), "ZITADEL_PROJECT_ID")).toBe("proj_file");
  });
});

/**
 * The asker the command would hand in, answering with `answer`. It records
 * which method was asked, because which one is the behaviour: a credential is
 * never echoed, and a normal command must not be drawn a prompt.
 */
function asking(answer: string) {
  const refuse = () => {
    throw new Error("not asked by this question");
  };
  return {
    text: vi.fn(async () => answer),
    secret: vi.fn(async () => answer),
    select: vi.fn(refuse),
    multiselect: vi.fn(refuse),
    confirm: vi.fn(refuse),
  } as unknown as Questions & {
    text: ReturnType<typeof vi.fn>;
    secret: ReturnType<typeof vi.fn>;
  };
}

describe("requireValueInteractive", () => {
  it("throws without prompting when non-interactive", async () => {
    const ask = asking("unused");
    const environment = await resolve({ envName: "production" });

    await expect(
      requireValueInteractive(environment, "ZITADEL_PROJECT_ID", {
        cwd: dir,
        interactive: false,
        ask,
      }),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
    expect(ask.text).not.toHaveBeenCalled();
  });

  it("prompts for a missing value and persists it to .env.<name>.local", async () => {
    const ask = asking("proj_prompted");
    const environment = await resolve({ envName: "production" });

    const value = await requireValueInteractive(environment, "ZITADEL_PROJECT_ID", {
      cwd: dir,
      interactive: true,
      ask,
    });

    expect(value).toBe("proj_prompted");
    expect(await readFile(join(dir, ".env.production.local"), "utf8")).toContain(
      "ZITADEL_PROJECT_ID=proj_prompted",
    );
  });

  // The command hands in its own asker, so a normal command's question is one
  // plain line. Minting a drawn asker here put a clack gutter above the answer
  // of every environment command that had a value to ask for.
  it("asks through the asker it was given, never one of its own", async () => {
    const { text, password } = await import("@clack/prompts");
    const ask = asking("proj_prompted");
    const environment = await resolve({ envName: "production" });

    await requireValueInteractive(environment, "ZITADEL_PROJECT_ID", {
      cwd: dir,
      interactive: true,
      ask,
    });

    expect(ask.text).toHaveBeenCalledOnce();
    expect(text).not.toHaveBeenCalled();
    expect(password).not.toHaveBeenCalled();
  });

  it("asks for a credential as a secret, so it is never echoed", async () => {
    const ask = asking("sk_typed");
    const environment = await resolve({ envName: "production" });

    await requireValueInteractive(environment, "ZITADEL_PROJECT_SECRET", {
      cwd: dir,
      interactive: true,
      ask,
    });

    expect(ask.secret).toHaveBeenCalledOnce();
    expect(ask.text).not.toHaveBeenCalled();
  });

  it("keeps a value typed for an --env-file run out of .env.<name>.local", async () => {
    await write("ci.env", { ZITADEL_PROJECT_ID: "proj_ci" });
    const environment = await resolve({ envFile: "ci.env" });

    await requireValueInteractive(environment, "ZITADEL_PROJECT_SECRET", {
      cwd: dir,
      interactive: true,
      ask: asking("sk_typed"),
    });

    await expect(readFile(join(dir, ".env.development.local"), "utf8")).rejects.toThrow();
  });
});

describe("readBoundEnvironments", () => {
  it("lists the .env.<name>.local files that hold a project id, by name", async () => {
    await write(".env.production.local", {
      ZITADEL_PROJECT_ID: "proj_prod",
      ZITADEL_URL: "https://a.example",
    });
    await write(".env.development.local", { ZITADEL_PROJECT_ID: "proj_dev" });
    await write(".env.scratch.local", { ZITADEL_URL: "https://b.example" });
    await write(".env.local", { ZITADEL_PROJECT_ID: "proj_local" });

    const bound = await readBoundEnvironments(dir);

    expect(bound.map((entry) => [entry.name, entry.file])).toEqual([
      ["development", ".env.development.local"],
      ["production", ".env.production.local"],
    ]);
  });
});
