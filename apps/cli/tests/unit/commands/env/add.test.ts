import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseJson, runCliForTest, stripAnsi } from "../../../helpers/run-cli";

const SERVER = "https://api.zitadel.example";
const server = setupServer();

let created: Array<Record<string, unknown>> = [];

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  created = [];
  server.use(
    http.post(`${SERVER}/projects`, async ({ request }) => {
      created.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(
        {
          id: "proj_new",
          name: "created",
          project_secret: "sk_new_secret",
          preview_secret: "pk_new_preview",
          preview_origins: [],
          created_at: "2026-01-01T00:00:00.000Z",
        },
        { status: 201 },
      );
    }),
  );
});

afterEach(() => server.resetHandlers());

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeProject(framework: string | undefined = "next"): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-env-add-"));
  dirs.push(cwd);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(
    join(cwd, "zitadel.json"),
    JSON.stringify(framework === undefined ? {} : { framework: { id: framework } }),
  );
  return cwd;
}

interface Added {
  readonly keys: string[];
  readonly platform: Record<
    "production" | "preview" | "pipeline",
    Array<{
      name: string;
      value?: string;
      secret?: boolean;
    }>
  >;
}

async function add(cwd: string, ...extra: string[]) {
  const result = await runCliForTest([
    "env",
    "add",
    "production",
    "--cwd",
    cwd,
    "--server",
    SERVER,
    "--non-interactive",
    "--json",
    ...extra,
  ]);
  return { result, envelope: parseJson(result.stdout) as { data: Added; code?: string } };
}

/** The same, rendered for a terminal: what a person reads. */
async function addRendered(cwd: string, ...extra: string[]): Promise<string> {
  const result = await runCliForTest([
    "env",
    "add",
    "production",
    "--cwd",
    cwd,
    "--server",
    SERVER,
    "--non-interactive",
    ...extra,
  ]);
  return result.stdout;
}

const names = (variables: Added["platform"]["production"]): string[] =>
  variables.map((variable) => variable.name);

describe("env add", () => {
  describe("what it suggests next", () => {
    const suggested = (envelope: { data: Added }): string[] =>
      (envelope.data as unknown as { next_commands: string[] }).next_commands;

    it("names the new environment in every follow-up, not this run's", async () => {
      const cwd = await makeProject("next");

      const { envelope } = await add(cwd, "--app-url", "https://app.acme.com");

      expect(suggested(envelope).length).toBeGreaterThan(0);
      for (const command of suggested(envelope)) {
        expect(command).toMatch(/ --env production$/);
      }
    });

    it("offers no origin add without an app URL to add", async () => {
      const cwd = await makeProject("next");

      const { envelope } = await add(cwd);

      expect(suggested(envelope).some((command) => command.includes("origin add"))).toBe(false);
    });

    it("offers no origin add when the file holds no project secret to run it with", async () => {
      const cwd = await makeProject("next");

      const { envelope } = await add(
        cwd,
        "--project",
        "proj_existing",
        "--app-url",
        "https://app.acme.com",
      );

      expect(suggested(envelope).some((command) => command.includes("origin add"))).toBe(false);
    });

    it("quotes an IPv6 app origin in the follow-up a person reads", async () => {
      const cwd = await makeProject("next");

      const out = await addRendered(cwd, "--app-url", "http://[::1]:3000");

      expect(out).toContain("origin add 'http://[::1]:3000' --kind primary --env production");
    });

    it("tells a person the origin step waits on the project secret when none was written", async () => {
      const cwd = await makeProject("next");

      const out = await addRendered(cwd, "--project", "proj_existing");

      expect(out).toContain("once ZITADEL_PROJECT_SECRET is in .env.production.local");
    });

    it("names the app origin it already has in the step that waits on the secret", async () => {
      const cwd = await makeProject("next");

      const out = await addRendered(
        cwd,
        "--project",
        "proj_existing",
        "--app-url",
        "https://app.acme.com",
      );

      expect(out).toContain("origin add https://app.acme.com --kind primary --env production");
    });

    it("restricts the project to the app's origin first", async () => {
      const cwd = await makeProject("next");

      const { envelope } = await add(cwd, "--app-url", "https://app.acme.com");

      expect(suggested(envelope)[0]).toContain(
        "origin add https://app.acme.com --kind primary --env production",
      );
    });
  });

  it("keeps --project in the retry it suggests for a missing server", async () => {
    const cwd = await makeProject("next");

    const result = await runCliForTest([
      "env",
      "add",
      "staging",
      "--project",
      "proj_existing",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
    ]);

    const envelope = parseJson(result.stdout) as { next_commands?: string[] };
    expect(envelope.next_commands?.[0]).toContain("--project proj_existing");
  });

  describe("the file it writes", () => {
    it("holds the server, the project and both credentials, and the framework's twin of the id", async () => {
      const cwd = await makeProject("next");

      await add(cwd);

      expect(await readFile(join(cwd, ".env.production.local"), "utf8")).toBe(
        [
          `ZITADEL_URL=${SERVER}`,
          "ZITADEL_PROJECT_ID=proj_new",
          "ZITADEL_PROJECT_SECRET=sk_new_secret",
          "ZITADEL_PREVIEW_TOKEN=pk_new_preview",
          "NEXT_PUBLIC_ZITADEL_PROJECT_ID=proj_new",
          "",
        ].join("\n"),
      );
    });

    it("is readable by its owner alone", async () => {
      const cwd = await makeProject();

      await add(cwd);

      expect((await stat(join(cwd, ".env.production.local"))).mode & 0o777).toBe(0o600);
    });

    it("keeps that mode when --force rewrites a looser file", async () => {
      const cwd = await makeProject();
      await writeFile(join(cwd, ".env.production.local"), "OLD=1\n", { mode: 0o644 });

      await add(cwd, "--force");

      expect((await stat(join(cwd, ".env.production.local"))).mode & 0o777).toBe(0o600);
    });

    it("is left alone, and no project created, when it already exists", async () => {
      const cwd = await makeProject();
      await writeFile(join(cwd, ".env.production.local"), "OLD=1\n");

      const { envelope } = await add(cwd);

      expect(envelope.code).toBe("E_CONFLICT");
      expect(created).toEqual([]);
      expect(await readFile(join(cwd, ".env.production.local"), "utf8")).toBe("OLD=1\n");
    });

    it("names the twin each framework reads the project id under", async () => {
      const twins: Record<string, string | undefined> = {
        next: "NEXT_PUBLIC_ZITADEL_PROJECT_ID",
        nuxt: "NUXT_PUBLIC_ZITADEL_PROJECT_ID",
        react: "VITE_ZITADEL_PROJECT_ID",
        vue: "VITE_ZITADEL_PROJECT_ID",
        svelte: "VITE_ZITADEL_PROJECT_ID",
        solid: "VITE_ZITADEL_PROJECT_ID",
        qwik: "VITE_ZITADEL_PROJECT_ID",
        angular: undefined,
      };
      for (const [framework, twin] of Object.entries(twins)) {
        const cwd = await makeProject(framework);

        await add(cwd);

        const written = await readFile(join(cwd, ".env.production.local"), "utf8");
        expect(written.includes("_ZITADEL_PROJECT_ID="), framework).toBe(twin !== undefined);
        if (twin) {
          expect(written, framework).toContain(`${twin}=proj_new`);
        }
      }
    });

    it("binds an existing project without inventing its credentials", async () => {
      const cwd = await makeProject();

      await add(cwd, "--project", "proj_existing");

      expect(await readFile(join(cwd, ".env.production.local"), "utf8")).toBe(
        [
          `ZITADEL_URL=${SERVER}`,
          "ZITADEL_PROJECT_ID=proj_existing",
          "NEXT_PUBLIC_ZITADEL_PROJECT_ID=proj_existing",
          "",
        ].join("\n"),
      );
      expect(created).toEqual([]);
    });

    it("records the normalized --app-url as ZITADEL_ISSUER", async () => {
      const cwd = await makeProject();

      await add(cwd, "--app-url", "https://app.acme.com/some/path");

      expect(await readFile(join(cwd, ".env.production.local"), "utf8")).toContain(
        "ZITADEL_ISSUER=https://app.acme.com\n",
      );
    });
  });

  describe("the project it creates", () => {
    it("is named after the directory and the environment, without seeded defaults", async () => {
      const cwd = await makeProject();

      await add(cwd);

      expect(created).toEqual([{ name: `${basename(cwd)}-production`, seed_defaults: false }]);
    });

    it("registers the app's own URL as an origin", async () => {
      const cwd = await makeProject();

      await add(cwd, "--app-url", "https://app.acme.com/some/path");

      expect(created[0]).toMatchObject({ preview_origins: ["https://app.acme.com"] });
    });
  });

  describe("the variables it prints for the platform", () => {
    it.each([
      [
        "next",
        [
          "ZITADEL_URL",
          "ZITADEL_PROJECT_ID",
          "NEXT_PUBLIC_ZITADEL_PROJECT_ID",
          "ZITADEL_PROJECT_SECRET",
          "ZITADEL_ENV",
          "ZITADEL_ENVIRONMENT",
          "ZITADEL_ISSUER",
        ],
        [
          "ZITADEL_URL",
          "ZITADEL_PROJECT_ID",
          "NEXT_PUBLIC_ZITADEL_PROJECT_ID",
          "ZITADEL_ENV",
          "ZITADEL_ENVIRONMENT",
          "ZITADEL_PREVIEW_TOKEN",
        ],
      ],
      [
        "nuxt",
        [
          "ZITADEL_URL",
          "ZITADEL_PROJECT_ID",
          "NUXT_PUBLIC_ZITADEL_PROJECT_ID",
          "ZITADEL_PROJECT_SECRET",
          "ZITADEL_ENV",
          "ZITADEL_ENVIRONMENT",
          "ZITADEL_ISSUER",
        ],
        [
          "ZITADEL_URL",
          "ZITADEL_PROJECT_ID",
          "NUXT_PUBLIC_ZITADEL_PROJECT_ID",
          "ZITADEL_ENV",
          "ZITADEL_ENVIRONMENT",
          "ZITADEL_PREVIEW_TOKEN",
        ],
      ],
      ...["react", "vue", "svelte", "solid", "qwik"].map((framework) => [
        framework,
        ["ZITADEL_URL", "ZITADEL_PROJECT_ID", "VITE_ZITADEL_PROJECT_ID", "ZITADEL_ENV"],
        [
          "ZITADEL_URL",
          "ZITADEL_PROJECT_ID",
          "VITE_ZITADEL_PROJECT_ID",
          "ZITADEL_ENV",
          "ZITADEL_PREVIEW_TOKEN",
        ],
      ]),
      [
        "angular",
        ["ZITADEL_URL", "ZITADEL_PROJECT_ID", "ZITADEL_ENV"],
        ["ZITADEL_URL", "ZITADEL_PROJECT_ID", "ZITADEL_ENV", "ZITADEL_PREVIEW_TOKEN"],
      ],
    ] as Array<[string, string[], string[]]>)(
      "lists, for %s, the production and preview scopes",
      async (framework, production, preview) => {
        const cwd = await makeProject(framework);

        const { envelope } = await add(cwd);

        expect(names(envelope.data.platform.production)).toEqual(production);
        expect(names(envelope.data.platform.preview)).toEqual(preview);
      },
    );

    it("lists the same three variables for the pipeline whatever the framework", async () => {
      for (const framework of ["next", "react", "angular"]) {
        const cwd = await makeProject(framework);

        const { envelope } = await add(cwd);

        expect(names(envelope.data.platform.pipeline), framework).toEqual([
          "ZITADEL_URL",
          "ZITADEL_PROJECT_ID",
          "ZITADEL_PROJECT_SECRET",
        ]);
      }
    });

    it("marks the project secret and the preview token as secrets and gives no value for them", async () => {
      const cwd = await makeProject("next");

      const { envelope, result } = await add(cwd);

      const secrets = [
        ...envelope.data.platform.production,
        ...envelope.data.platform.preview,
        ...envelope.data.platform.pipeline,
      ].filter((variable) => variable.secret);
      expect(secrets.map((variable) => variable.name).sort()).toEqual([
        "ZITADEL_PREVIEW_TOKEN",
        "ZITADEL_PROJECT_SECRET",
        "ZITADEL_PROJECT_SECRET",
      ]);
      expect(secrets.every((variable) => variable.value === undefined)).toBe(true);
      expect(result.stdout).not.toContain("sk_new_secret");
      expect(result.stdout).not.toContain("pk_new_preview");
    });

    it("gives the app URL as the issuer, as an origin", async () => {
      const cwd = await makeProject("next");

      const { envelope } = await add(cwd, "--app-url", "https://app.acme.com/login");

      expect(
        envelope.data.platform.production.find((v) => v.name === "ZITADEL_ISSUER")?.value,
      ).toBe("https://app.acme.com");
    });

    it("leaves the issuer a placeholder when no app URL was given", async () => {
      const cwd = await makeProject("next");

      const { envelope } = await add(cwd);

      expect(
        envelope.data.platform.production.find((v) => v.name === "ZITADEL_ISSUER")?.value,
      ).toMatch(/^</);
    });

    it("refuses an app URL that is not an http(s) URL", async () => {
      const cwd = await makeProject("next");

      const { envelope } = await add(cwd, "--app-url", "ftp://app.acme.com");

      expect(envelope.code).toBe("E_VALIDATION");
      expect(created).toEqual([]);
    });

    it("does not tell the user to copy a secret from a file that never received one", async () => {
      const cwd = await makeProject("next");

      const result = await runCliForTest([
        "env",
        "add",
        "production",
        "--cwd",
        cwd,
        "--server",
        SERVER,
        "--project",
        "proj_existing",
        "--non-interactive",
      ]);

      const out = stripAnsi(result.stdout);
      expect(out).not.toContain("copy it from .env.production.local");
      expect(out).toContain("copy it from wherever you got this project");
    });
  });

  describe("the name", () => {
    it("must be usable in a file name", async () => {
      const cwd = await makeProject();

      const result = await runCliForTest([
        "env",
        "add",
        "../escape",
        "--cwd",
        cwd,
        "--server",
        SERVER,
        "--non-interactive",
        "--json",
      ]);

      expect((parseJson(result.stdout) as { code: string }).code).toBe("E_VALIDATION");
    });
  });
});
