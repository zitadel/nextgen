import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

import { confirm } from "@clack/prompts";

import EnvAdd from "../../../../src/commands/env/add";
import { parseJson, runCliForTest, stripAnsi } from "../../../helpers/run-cli";
import { asTerminal } from "../../../helpers/terminal";

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

/**
 * Binds an existing project, with its secret in the process environment as the
 * teammate who sent the id would have it, so the follow-ups that need a
 * credential are offered.
 */
async function addBound(cwd: string, ...extra: string[]) {
  const result = await runCliForTest(
    [
      "env",
      "add",
      "production",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--non-interactive",
      "--json",
      "--project",
      "proj_existing",
      ...extra,
    ],
    { ZITADEL_PROJECT_SECRET: "sk_proj_existing_full" },
  );
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
        expect(command).toContain(" --env-file .env.production.local");
      }
    });

    it("quotes the app-url placeholder a person reads, so a paste cannot redirect", async () => {
      const cwd = await makeProject("next");

      const out = await addRendered(cwd, "--project", "proj_existing");

      expect(out).toContain("origin add '<your-app-url>' --kind primary");
    });

    it("offers the deploy that makes the new environment serve .zitadel/", async () => {
      const cwd = await makeProject("next");

      const { envelope } = await add(cwd);

      expect(suggested(envelope).some((command) => command.includes("deploy -m"))).toBe(true);
    });

    it("reports no deployment when it made none", async () => {
      const cwd = await makeProject("next");

      const { envelope } = await add(cwd);

      expect((envelope.data as unknown as { deployment: unknown }).deployment).toBeNull();
    });

    it("offers no deploy for a project it only bound", async () => {
      const cwd = await makeProject("next");

      const { envelope } = await addBound(cwd);

      expect(suggested(envelope).some((command) => command.includes("deploy -m"))).toBe(false);
    });

    it("says what the environment serves until something is deployed to it", async () => {
      const cwd = await makeProject("next");

      const out = stripAnsi(await addRendered(cwd));

      expect(out).toContain(
        "Nothing is deployed to production yet, so it serves the server's defaults rather than .zitadel/.",
      );
    });

    it("names the deploy a person should run, against the new environment", async () => {
      const cwd = await makeProject("next");

      const out = stripAnsi(await addRendered(cwd));

      expect(out).toContain(
        "Deploy to it: zitadel deploy -m '<what changed>' --env-file .env.production.local",
      );
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

      const out = await addRendered(
        cwd,
        "--project",
        "proj_existing",
        "--app-url",
        "http://[::1]:3000",
      );

      expect(out).toContain(
        "origin add 'http://[::1]:3000' --kind primary --env-file .env.production.local",
      );
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

      expect(out).toContain(
        "origin add https://app.acme.com --kind primary --env-file .env.production.local",
      );
    });

    it("offers no origin add for a project it created, which already holds the app URL", async () => {
      const cwd = await makeProject("next");

      const { envelope } = await add(cwd, "--app-url", "https://app.acme.com");

      expect(suggested(envelope).some((command) => command.includes("origin add"))).toBe(false);
    });

    it("restricts a bound project to the app's origin first", async () => {
      const cwd = await makeProject("next");

      const { envelope } = await addBound(cwd, "--app-url", "https://app.acme.com");

      expect(suggested(envelope)[0]).toContain(
        "origin add https://app.acme.com --kind primary --env-file .env.production.local",
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

  it("names --cwd once in the retry it suggests for a missing server", async () => {
    const cwd = await makeProject("next");

    const result = await runCliForTest([
      "env",
      "add",
      "staging",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
    ]);

    const envelope = parseJson(result.stdout) as { next_commands?: string[] };
    expect(envelope.next_commands?.[0]?.split(" --cwd ")).toHaveLength(2);
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

    it("registers the app's own URL as a primary origin", async () => {
      const cwd = await makeProject();

      await add(cwd, "--app-url", "https://app.acme.com/some/path");

      expect(created[0]).toMatchObject({
        origins: [{ pattern: "https://app.acme.com", kind: "primary" }],
      });
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

/**
 * The deploy `env add` offers runs only when a person is there to accept it,
 * so it is driven the way `branding eject`'s prompt is: the command from
 * source, with clack doubled and the streams pretending to be a terminal.
 */
describe("env add asked on a terminal", () => {
  /** A project holding resources that validate, so a deploy can be built from it. */
  async function makeDeployableProject(): Promise<string> {
    const cwd = await makeProject("next");
    const defaults = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../../packages/config/defaults",
    );
    const resolve = async (name: string): Promise<string> =>
      (await readFile(join(defaults, name), "utf8"))
        .replaceAll("${SERVER_URL}", SERVER)
        .replaceAll("${USER_SCHEMA_URL}", `${SERVER}/schemas/human-user.json`);
    await mkdir(join(cwd, ".zitadel", "schemas"), { recursive: true });
    await mkdir(join(cwd, ".zitadel", "flows"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel", "schemas", "human-user.json"),
      await resolve("default-human-user.json"),
    );
    await writeFile(
      join(cwd, ".zitadel", "flows", "default-login.json"),
      await resolve("default-login.json"),
    );
    return cwd;
  }

  /** The platform accepts the release and the deployment. */
  function platformDeploys(): void {
    server.use(
      http.post(`${SERVER}/releases/build`, () =>
        HttpResponse.json({ id: "rel_1", content_hash: "sha256:abc" }, { status: 201 }),
      ),
      http.post(`${SERVER}/deployments`, () =>
        HttpResponse.json(
          { id: "dep_1", targets: [{ origin: "https://app.acme.com", expires_at: null }] },
          { status: 201 },
        ),
      ),
    );
  }

  /** The platform refuses to build the release. */
  function platformRefusesTheRelease(): void {
    server.use(
      http.post(`${SERVER}/releases/build`, () =>
        HttpResponse.json({ code: "rel.invalid", message: "no" }, { status: 400 }),
      ),
    );
  }

  const adding = (cwd: string, ...extra: string[]) =>
    asTerminal(() =>
      EnvAdd.run([
        "staging",
        "--cwd",
        cwd,
        "--server",
        SERVER,
        "--app-url",
        "https://app.acme.com",
        ...extra,
      ]),
    );

  afterEach(() => {
    vi.mocked(confirm).mockReset();
  });

  it("deploys the project when the offer is accepted", async () => {
    const cwd = await makeDeployableProject();
    platformDeploys();
    vi.mocked(confirm).mockResolvedValueOnce(true as never);

    const envelope = (await adding(cwd)) as { data: { deployment: unknown } };

    expect(envelope.data.deployment).toMatchObject({
      release_id: "rel_1",
      deployment_id: "dep_1",
      origins: ["https://app.acme.com"],
    });
  });

  it("deploys nothing when the offer is declined", async () => {
    const cwd = await makeDeployableProject();
    vi.mocked(confirm).mockResolvedValueOnce(false as never);

    const envelope = (await adding(cwd)) as { data: { deployment: unknown } };

    expect(envelope.data.deployment).toBeNull();
  });

  it("still names the deploy after the offer is declined", async () => {
    const cwd = await makeDeployableProject();
    vi.mocked(confirm).mockResolvedValueOnce(false as never);

    const envelope = (await adding(cwd)) as { data: { next_commands: string[] } };

    expect(envelope.data.next_commands.some((command) => command.includes("deploy -m"))).toBe(true);
  });

  it("binds the environment even when the deploy fails", async () => {
    const cwd = await makeDeployableProject();
    platformRefusesTheRelease();
    vi.mocked(confirm).mockResolvedValueOnce(true as never);

    const envelope = (await adding(cwd)) as { status: string; data: { deployment: unknown } };

    expect(envelope.status).toBe("ok");
    expect(envelope.data.deployment).toBeNull();
  });

  it("warns, naming the deploy to re-run, when the deploy fails", async () => {
    const cwd = await makeDeployableProject();
    platformRefusesTheRelease();
    vi.mocked(confirm).mockResolvedValueOnce(true as never);

    const envelope = (await adding(cwd)) as { warnings: string[] };

    expect(envelope.warnings.join("\n")).toContain("deploy -m");
  });

  it("never asks for a project it only bound", async () => {
    const cwd = await makeDeployableProject();

    await adding(cwd, "--project", "proj_existing");

    expect(confirm).not.toHaveBeenCalled();
  });
});
