import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, readdir, readFile, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect, vi } from "vitest";

import {
  ClaimCheck,
  ConfigCheck,
  DependencyCheck,
  DependencyVersionCheck,
  EnvExampleCheck,
  FrameworkCheck,
  GitignoreCheck,
  ManagedFilesCheck,
  MetaSchemasCheck,
  ProjectMatchCheck,
  SecretCheck,
  SecretPermissionsCheck,
} from "@/cli/commands/doctor/checks";
import { loadPatchContext } from "@/cli/commands/doctor/patch-context";
import { type ProjectMetaSchema, projectMetaSchemas } from "@/lib/meta-schemas";
import { createOrca } from "@/lib/orca";
import {
  launcherTemplate,
  PROJECT_ID_GUARD,
  proxyConfTemplate,
} from "@/lib/orca/patchers/rule/angular/templates";
import { MANAGED_MARKER } from "@/lib/paths";
import { hashScaffoldFile } from "@/lib/scaffold-manifest";
import { aCheckContext, CHECK_CLI_VERSION } from "@tests/helpers/check-context";
import { aUserSchema } from "@tests/helpers/config";
import { it } from "@tests/helpers/fixtures";
import { git, ignoredByGit, isolateGit, write } from "@tests/helpers/git-repo";
import { asAnOlderSetupLeft, SVELTEKIT_GITIGNORE } from "@tests/helpers/gitignore";
import { readJson } from "@tests/helpers/local-project";
import { bearerOnlyProxyConf, v1ProxyConf } from "@tests/helpers/proxy-conf";
import { rejectionOf } from "@tests/helpers/thrown-value";
import { viteConfig, withFixedAddress, withoutBlankLines } from "@tests/helpers/vite-config";

/**
 * The project the config and the secret name.
 */
const PROJECT_ID = "proj-001";

/**
 * The server the config names: the hosted cloud.
 */
const CLOUD = "https://api.zitadel.cloud";

/**
 * The issuer a Next project's `.env.local` names.
 */
const ISSUER = "http://localhost:3000";

/**
 * The project's credentials file.
 */
const SECRET_FILE = ".zitadel/secret";

/**
 * Where setup records what it scaffolded.
 */
const STATE_FILE = ".zitadel/state.json";

/**
 * The project's user schema.
 */
const SCHEMA_FILE = ".zitadel/schemas/user.json";

/**
 * Next's request boundary up to Next 15.
 */
const MIDDLEWARE = "middleware.ts";

/**
 * Next's request boundary from Next 16 on.
 */
const PROXY = "proxy.ts";

/**
 * The scaffolded sign-in page.
 */
const LOGIN_PAGE = "app/login/page.tsx";

/**
 * The scaffolded sign-up page.
 */
const REGISTER_PAGE = "app/register/page.tsx";

/**
 * The framework home page, scaffolded only into a fresh app.
 */
const HOME_PAGE = "app/page.tsx";

/**
 * The route layout a newer setup adds beside the sign-in page.
 */
const LOGIN_LAYOUT = "app/login/layout.tsx";

/**
 * An Angular project's managed dev proxy.
 */
const ANGULAR_PROXY = "proxy.conf.cjs";

/**
 * A Vite app's config, into which setup merges the dev proxy.
 */
const VITE_CONFIG = "vite.config.ts";

/**
 * A recorded hash no file on disk has, so the file reads as edited.
 */
const EDITED_HASH = "0".repeat(64);

/**
 * The branding meta-schema's path.
 */
const META_BRANDING = ".zitadel/meta/branding.json";

/**
 * The flow-definition meta-schema's path.
 */
const META_FLOW = ".zitadel/meta/flow-definition.json";

/**
 * A CLI release the dependency-version check compares pins against.
 */
const RELEASE = "0.1.0-alpha.18";

/**
 * The release before {@link RELEASE}.
 */
const TRAILING = "0.1.0-alpha.17";

/**
 * A Next managed boundary file as setup wrote it.
 */
const MANAGED_MIDDLEWARE = `${MANAGED_MARKER}\nexport function middleware() {}\n`;

/**
 * A Next managed boundary file the developer edited.
 */
const EDITED_MIDDLEWARE = `${MANAGED_MARKER}\nexport function middleware() { /* custom */ }\n`;

/**
 * A Next 16 app's `package.json`, which has the SDK.
 */
const NEXT_16_PACKAGE = {
  name: "demo",
  dependencies: { next: "^16", "@zitadel/sdk-next": "latest" },
};

/**
 * The project's secret.
 *
 * @remarks
 * Created a minute ago, so the claim window reads as open.
 */
const SECRET = {
  project_id: PROJECT_ID,
  project_secret: "sk_proj_test",
  preview_secret: "sk_proj_preview",
  primary_origins: [],
  preview_origins: [],
  created_at: new Date(Date.now() - 60_000).toISOString(),
};

/**
 * The SDK packages a doctor names as missing for each framework, as the
 * framework's own patcher adds them, the widget SDK included.
 */
const SDK_PACKAGES_BY_FRAMEWORK = [
  ["next", { next: "^16" }, "@zitadel/sdk-next"],
  ["nuxt", { nuxt: "^4" }, "@zitadel/sdk-nuxt"],
  ["react", { react: "^19", vite: "^8" }, "@zitadel/sdk-react"],
  ["vue", { vue: "^3.5", vite: "^8" }, "@zitadel/sdk-vue"],
  ["solid", { "solid-js": "^1.9", vite: "^8" }, "@zitadel/sdk-solid"],
  ["svelte", { svelte: "^5", vite: "^8" }, "@zitadel/sdk-svelte"],
  ["qwik", { "@qwik.dev/core": "^2.0.0-beta.45", vite: "^8" }, "@zitadel/sdk-qwik"],
  ["angular", { "@angular/core": "^20" }, "@zitadel/sdk-angular"],
  [
    "sveltekit",
    { "@sveltejs/kit": "^3", svelte: "^5" },
    "@zitadel/sdk-sveltekit, @zitadel/sdk-svelte",
  ],
  [
    "tanstack-start",
    { react: "^19", "@tanstack/react-start": "^1.168.10" },
    "@zitadel/sdk-tanstack-start",
  ],
  [
    "solid-start",
    { "solid-js": "^1.9", "@solidjs/start": "^2.0.0" },
    "@zitadel/sdk-solid-start, @zitadel/sdk-solid",
  ],
  [
    "qwik-router",
    { "@qwik.dev/core": "^2.0.0-beta.45", "@qwik.dev/router": "^2.0.0-beta.45" },
    "@zitadel/sdk-qwik-router, @zitadel/sdk-qwik",
  ],
] as const;

/**
 * The Nuxt plugins an older setup wrote and a newer one no longer does.
 */
const RETIRED_NUXT_PLUGINS = [
  "app/plugins/auth.server.ts",
  "app/plugins/zitadel-components.client.ts",
] as const;

/**
 * Writes `body` as `.zitadel/secret`, at the 0600 mode doctor asserts.
 *
 * @param dir - The project directory.
 * @param body - The secret's content.
 */
async function writeSecret(dir: string, body: object): Promise<void> {
  await write(dir, { [SECRET_FILE]: JSON.stringify(body) });
  await chmod(join(dir, SECRET_FILE), 0o600);
}

/**
 * Writes `.zitadel/state.json` for a Next app, carrying `scaffold` as its
 * scaffold manifest, or none when it is undefined.
 *
 * @param dir - The project directory.
 * @param scaffold - The manifest as it is on disk, which may be malformed.
 */
async function writeScaffold(dir: string, scaffold?: unknown): Promise<void> {
  await write(dir, {
    [STATE_FILE]: JSON.stringify({ framework: "next", resources: {}, scaffold }),
  });
}

/**
 * Fills `dir` with a healthy Next.js managed project: every check passes against it.
 *
 * @param dir - The directory to fill.
 */
async function aNextProject(dir: string): Promise<void> {
  await write(dir, {
    "package.json": JSON.stringify({
      name: "demo",
      dependencies: { next: "^15", "@zitadel/sdk-next": "latest" },
    }),
    "zitadel.json": JSON.stringify({
      project: PROJECT_ID,
      server: CLOUD,
      framework: { id: "next" },
    }),
    ".env.local": `ZITADEL_ISSUER=${ISSUER}\n`,
    ".gitignore": [SECRET_FILE, ".env*", "!.env.example"].join("\n"),
    ".env.example": ["ZITADEL_PROJECT_ID=", "ZITADEL_ENVIRONMENT=", "ZITADEL_ISSUER="].join("\n"),
    [SCHEMA_FILE]: JSON.stringify(aUserSchema()),
    [LOGIN_PAGE]: `${MANAGED_MARKER}\nexport default function L() {}\n`,
    [REGISTER_PAGE]: `${MANAGED_MARKER}\nexport default function R() {}\n`,
    "app/profile/page.tsx": `${MANAGED_MARKER}\nexport default function P() {}\n`,
    [MIDDLEWARE]: MANAGED_MIDDLEWARE,
    "custom-elements.d.ts": `${MANAGED_MARKER}\nexport {};\n`,
  });
  await writeSecret(dir, SECRET);
}

/**
 * Fills `dir` with a healthy Next.js managed project whose dev script is
 * `devScript` and whose registered issuer is on `issuerPort`.
 *
 * @remarks
 * The dev script is verified against the port the project registered as its
 * allowed origin, not the port the app starts on now: reading the live script
 * would verify an edited script against itself, and a repair would write back
 * the detected fallback instead of the port the server allows.
 *
 * @param dir - The directory to fill.
 * @param devScript - The `dev` script.
 * @param issuerPort - The port of the issuer `.env.local` names.
 */
async function aNextProjectWithDevScript(
  dir: string,
  devScript: string,
  issuerPort: number,
): Promise<void> {
  await aNextProject(dir);
  await write(dir, {
    "package.json": JSON.stringify({
      name: "demo",
      scripts: { dev: devScript },
      dependencies: { next: "^15", "@zitadel/sdk-next": "latest" },
    }),
    ".env.local": `ZITADEL_ISSUER=http://localhost:${issuerPort}\n`,
  });
}

/**
 * Fills `dir` with a healthy Angular managed project with every config wiring
 * applied: `angular.json` carries the proxy config and the port, the auth
 * routes are in the route table, and a `dev` script exists.
 *
 * @param dir - The directory to fill.
 */
async function anAngularProject(dir: string): Promise<void> {
  await write(dir, {
    "package.json": JSON.stringify({
      name: "demo",
      scripts: { dev: "node zitadel-ng.cjs serve" },
      dependencies: { "@angular/core": "^19.0.0", "@zitadel/sdk-angular": "latest" },
    }),
    "zitadel.json": JSON.stringify({
      project: PROJECT_ID,
      server: CLOUD,
      framework: { id: "angular" },
    }),
    ".env.local": "ZITADEL_ISSUER=http://localhost:4200\n",
    "angular.json": JSON.stringify({
      projects: {
        demo: {
          architect: {
            serve: {
              options: {
                proxyConfig: ANGULAR_PROXY,
                port: 4200,
                define: { [PROJECT_ID_GUARD.name]: PROJECT_ID_GUARD.message },
              },
            },
          },
        },
      },
    }),
    "src/app/app.routes.ts": [
      'import { Routes } from "@angular/router";',
      "",
      "export const routes: Routes = [",
      '  { path: "login", children: [] },',
      '  { path: "register", children: [] },',
      '  { path: "profile", children: [] },',
      "];",
      "",
    ].join("\n"),
    "src/app/app.ts": `${MANAGED_MARKER}\nexport class App {}\n`,
    "src/app/app.html": `<!-- ${MANAGED_MARKER} -->\n<main></main>\n`,
    [ANGULAR_PROXY]: proxyConfTemplate(),
    "zitadel-ng.cjs": launcherTemplate(),
  });
  await writeSecret(dir, SECRET);
}

/**
 * `ZITADEL_URL` in the env files setup writes, as it writes them: the server
 * `zitadel.json` names.
 */
const SETUP_ENV_FILES = {
  ".env.local": `ZITADEL_ISSUER=http://localhost:5173\nZITADEL_URL=${CLOUD}\n`,
  ".env.development.local": `ZITADEL_URL=${CLOUD}\n`,
};

/**
 * A server other than {@link CLOUD}.
 */
const OTHER_SERVER = "https://other.example";

/**
 * Fills `dir` with a React (Vite) managed project whose `vite.config.ts` is
 * `config`, with `files` beside it, its env files as setup writes them unless
 * `files` replaces one.
 *
 * @param dir - The directory to fill.
 * @param config - The Vite config.
 * @param files - Files written over the project's own, such as an env file.
 */
async function aReactProject(
  dir: string,
  config: string,
  files: Readonly<Record<string, string>> = {},
): Promise<void> {
  await write(dir, {
    "package.json": JSON.stringify({
      name: "demo",
      dependencies: { react: "^19", vite: "^8", "@zitadel/sdk-react": "latest" },
    }),
    "zitadel.json": JSON.stringify({
      project: PROJECT_ID,
      server: CLOUD,
      framework: { id: "react" },
    }),
    ...SETUP_ENV_FILES,
    [VITE_CONFIG]: config,
    "src/App.tsx": `${MANAGED_MARKER}\nexport default function App() {}\n`,
    ...files,
  });
  await writeSecret(dir, SECRET);
}

/**
 * Fills `dir` with a Nuxt 4 app as an older setup left it: every page and
 * plugin it wrote is on disk, and its manifest records both plugins as
 * infrastructure.
 *
 * @param dir - The directory to fill.
 */
async function anOlderNuxtProject(dir: string): Promise<void> {
  const contents = `// ${MANAGED_MARKER}\n`;
  const hash = hashScaffoldFile(contents);
  const pages = ["app/pages/login.vue", "app/pages/register.vue", "app/pages/profile.vue"];
  await write(dir, {
    "package.json": JSON.stringify({
      name: "demo",
      dependencies: { nuxt: "^4.1.0", "@zitadel/sdk-nuxt": "latest" },
    }),
    "zitadel.json": JSON.stringify({
      project: PROJECT_ID,
      server: CLOUD,
      framework: { id: "nuxt" },
      environments: { development: { issuer: ISSUER } },
    }),
    "nuxt.config.ts": "export default defineNuxtConfig({});\n",
    ...Object.fromEntries(
      [...pages, ...RETIRED_NUXT_PLUGINS].map((path) => {
        return [path, contents];
      }),
    ),
    [STATE_FILE]: JSON.stringify({
      framework: "nuxt",
      resources: {},
      scaffold: {
        files: Object.fromEntries([
          ...pages.map((path) => {
            return [path, { hash, class: "presentation" }];
          }),
          ...RETIRED_NUXT_PLUGINS.map((path) => {
            return [path, { hash, class: "infrastructure" }];
          }),
        ]),
      },
    }),
  });
  await writeSecret(dir, SECRET);
}

/**
 * Writes every meta-schema as setup does for `cliVersion`.
 *
 * @param dir - The project directory.
 * @param cliVersion - The CLI version whose schemas to write.
 */
async function writeTheMetaSchemas(dir: string, cliVersion = CHECK_CLI_VERSION): Promise<void> {
  await write(
    dir,
    Object.fromEntries(
      projectMetaSchemas(cliVersion).map((file) => {
        return [file.path, file.contents];
      }),
    ),
  );
}

/**
 * This CLI's meta-schema at `path`.
 *
 * @param path - The meta-schema's project-relative path.
 * @returns The meta-schema.
 * @throws When this CLI ships none there.
 */
function thisCliMetaSchema(path: string): ProjectMetaSchema {
  const file = projectMetaSchemas(CHECK_CLI_VERSION).find((meta) => {
    return meta.path === path;
  });
  if (file === undefined) {
    throw new Error(`no meta-schema at ${path}`);
  }
  return file;
}

/**
 * The managed Angular proxy as the v2 template wrote it, which attaches the
 * project secret only to the exchange at the root.
 *
 * @returns The proxy's source.
 * @throws When the current template no longer holds what the v2 one lacked.
 */
function aV2ProxyConf(): string {
  const v2 = proxyConfTemplate()
    .replace("/* zitadel:proxy:v3 */", "/* zitadel:proxy:v2 */")
    .replace(
      '(pathname === "/sessions/exchange" || pathname === "/api/v1/sessions/exchange")',
      'pathname === "/sessions/exchange"',
    );
  if (v2 === proxyConfTemplate()) {
    throw new Error("the template no longer differs from the v2 proxy");
  }
  return v2;
}

/**
 * The managed Angular proxy rewritten so its bearer is set on every request,
 * in a shape no template matches.
 *
 * @returns The proxy's source.
 * @throws When the current template no longer holds the guarded bearer.
 */
function anUnguardedProxyConf(): string {
  const managed = proxyConfTemplate();
  const unsafe = managed.replace(
    `/* zitadel:proxy:v3 */
function setBearer(proxyReq) {
  const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
  if (
    proxyReq.method === "POST" &&
    (pathname === "/sessions/exchange" || pathname === "/api/v1/sessions/exchange") &&
    !proxyReq.getHeader("authorization")
  ) {
    proxyReq.setHeader("authorization", bearer);
  }
}`,
    `function setBearer(proxyReq) {
  proxyReq
    .setHeader("authorization", bearer);
}`,
  );
  if (unsafe === managed) {
    throw new Error("the template no longer holds the guarded bearer");
  }
  return unsafe;
}

/**
 * The managed proxy's session-cookie hooks from before ADR 083, changed by
 * hand so no template matches them.
 *
 * @returns The proxy's source.
 */
function aHandChangedV1ProxyConf(): string {
  return v1ProxyConf().replace(
    "function renameSessionCookie(proxyRes) {",
    'function renameSessionCookie(proxyRes) {\n  console.debug("cookies");',
  );
}

/**
 * The bearer-only managed proxy reformatted, so no template matches it and a
 * repair cannot add the session-cookie hooks.
 *
 * @returns The proxy's source.
 */
function aReformattedBearerOnlyProxyConf(): string {
  return bearerOnlyProxyConf().replace(
    'configure: (proxy) => proxy.on("proxyReq", setBearer),',
    "configure: (proxy) => proxy.on('proxyReq', setBearer),",
  );
}

/**
 * The text of a file in the project.
 *
 * @param dir - The project directory.
 * @param path - The file's project-relative path.
 * @returns Its content.
 */
function textOf(dir: string, path: string): Promise<string> {
  return readFile(join(dir, path), "utf8");
}

describe("ConfigCheck", () => {
  it("passes when zitadel.json parses", async ({ dir }) => {
    await aNextProject(dir);

    const outcome = await new ConfigCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("pass");
  });

  it("fails when zitadel.json is missing", async ({ dir }) => {
    await aNextProject(dir);
    await rm(join(dir, "zitadel.json"));

    const outcome = await new ConfigCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("fail");
  });

  describe("fix", () => {
    it("does nothing, without throwing", async ({ dir }) => {
      await aNextProject(dir);

      const error = await rejectionOf(() => {
        return new ConfigCheck().fix(aCheckContext(dir));
      });

      expect(error).toBeUndefined();
    });
  });
});

describe("SecretCheck", () => {
  it("passes when .zitadel/secret parses", async ({ dir }) => {
    await aNextProject(dir);

    const outcome = await new SecretCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("pass");
  });

  it("fails when .zitadel/secret is missing", async ({ dir }) => {
    await aNextProject(dir);
    await rm(join(dir, SECRET_FILE));

    const outcome = await new SecretCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("fail");
  });
});

describe("SecretPermissionsCheck", () => {
  it("passes at 0600", async ({ dir }) => {
    await aNextProject(dir);

    const outcome = await new SecretPermissionsCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("pass");
  });

  it("fails at 0644", async ({ dir }) => {
    await aNextProject(dir);
    await chmod(join(dir, SECRET_FILE), 0o644);

    const outcome = await new SecretPermissionsCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("fail");
  });

  describe("fix", () => {
    it("re-locks the secret to 0600", async ({ dir }) => {
      await aNextProject(dir);
      await chmod(join(dir, SECRET_FILE), 0o644);

      await new SecretPermissionsCheck().fix(aCheckContext(dir));

      expect((await stat(join(dir, SECRET_FILE))).mode & 0o777).toBe(0o600);
    });

    it("leaves the mode as it is on a dry run", async ({ dir }) => {
      await aNextProject(dir);
      await chmod(join(dir, SECRET_FILE), 0o644);

      await new SecretPermissionsCheck().fix(aCheckContext(dir, { dryRun: true }));

      expect((await stat(join(dir, SECRET_FILE))).mode & 0o777).toBe(0o644);
    });
  });
});

/** A SvelteKit `.gitignore` as an older setup left it: its `.env*` after the generator's `!.env.example`. */
const AN_OLDER_SETUPS_GITIGNORE = asAnOlderSetupLeft(SVELTEKIT_GITIGNORE);

/** An `.env.example` someone filled in: a value in it may be a secret. */
const A_FILLED_IN_ENV_EXAMPLE = "ZITADEL_PROJECT_ID=\nZITADEL_PROJECT_SECRET=s3cr3t\n";

/** Every file setup writes that holds a secret, and a customer's own env files. */
const IGNORED_PATHS = [
  SECRET_FILE,
  ".env.local",
  ".env.development.local",
  ".env.test",
  ".env.production",
];

describe("GitignoreCheck", () => {
  beforeEach(() => {
    isolateGit();
  });

  it("fails when a file holding a secret is not ignored", async ({ dir }) => {
    await aNextProject(dir);
    await write(dir, { ".gitignore": `${SECRET_FILE}\n` });

    const outcome = await new GitignoreCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("fail");
  });

  it("passes when the generator's own lines already ignore the env files", async ({ dir }) => {
    await aNextProject(dir);
    await write(dir, { ".gitignore": `.env\n.env.*\n!.env.example\n${SECRET_FILE}\n` });

    const outcome = await new GitignoreCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("pass");
  });

  describe("with .env.example ignored, as an older setup left a SvelteKit app", () => {
    it("warns rather than fails", async ({ dir }) => {
      await aNextProject(dir);
      await write(dir, { ".gitignore": AN_OLDER_SETUPS_GITIGNORE });

      const outcome = await new GitignoreCheck().run(aCheckContext(dir));

      expect(outcome.status).toBe("warn");
    });

    it("offers doctor --fix", async ({ dir }) => {
      await aNextProject(dir);
      await write(dir, { ".gitignore": AN_OLDER_SETUPS_GITIGNORE });

      const outcome = await new GitignoreCheck().run(aCheckContext(dir));

      expect(outcome.remedy).toContain("doctor --fix");
    });

    it("offers no repair while .env.example holds a value", async ({ dir }) => {
      await aNextProject(dir);
      await write(dir, {
        ".gitignore": AN_OLDER_SETUPS_GITIGNORE,
        ".env.example": A_FILLED_IN_ENV_EXAMPLE,
      });

      const outcome = await new GitignoreCheck().run(aCheckContext(dir));

      expect(outcome.remedy).toBeUndefined();
    });
  });

  describe("fix", () => {
    it("makes git ignore every missing secret", async ({ dir }) => {
      await aNextProject(dir);
      await git(dir, "init", "--quiet");
      await write(dir, { ".gitignore": `${SECRET_FILE}\n` });

      await new GitignoreCheck().fix(aCheckContext(dir));

      expect(await ignoredByGit(dir, [...IGNORED_PATHS, ".env.example"])).toEqual(IGNORED_PATHS);
    });

    it("leaves the check passing", async ({ dir }) => {
      await aNextProject(dir);
      await write(dir, { ".gitignore": `${SECRET_FILE}\n` });

      await new GitignoreCheck().fix(aCheckContext(dir));

      expect((await new GitignoreCheck().run(aCheckContext(dir))).status).toBe("pass");
    });

    it("creates .gitignore when it is absent", async ({ dir }) => {
      await aNextProject(dir);
      await rm(join(dir, ".gitignore"));

      await new GitignoreCheck().fix(aCheckContext(dir));

      expect((await new GitignoreCheck().run(aCheckContext(dir))).status).toBe("pass");
    });

    it("writes nothing on a dry run", async ({ dir }) => {
      await aNextProject(dir);
      await write(dir, { ".gitignore": `${SECRET_FILE}\n` });

      await new GitignoreCheck().fix(aCheckContext(dir, { dryRun: true }));

      expect((await new GitignoreCheck().run(aCheckContext(dir))).status).toBe("fail");
    });

    describe("with .env.example ignored, as an older setup left a SvelteKit app", () => {
      it("makes git keep .env.example", async ({ dir }) => {
        await aNextProject(dir);
        await git(dir, "init", "--quiet");
        await write(dir, { ".gitignore": AN_OLDER_SETUPS_GITIGNORE });

        await new GitignoreCheck().fix(aCheckContext(dir));

        expect(await ignoredByGit(dir, [".env.example"])).toEqual([]);
      });

      it("un-ignores no file that holds a secret", async ({ dir }) => {
        await aNextProject(dir);
        await git(dir, "init", "--quiet");
        await write(dir, { ".gitignore": AN_OLDER_SETUPS_GITIGNORE });

        await new GitignoreCheck().fix(aCheckContext(dir));

        expect(await ignoredByGit(dir, IGNORED_PATHS)).toEqual(IGNORED_PATHS);
      });

      it("leaves .env.example ignored while it holds a value", async ({ dir }) => {
        await aNextProject(dir);
        await git(dir, "init", "--quiet");
        await write(dir, {
          ".gitignore": AN_OLDER_SETUPS_GITIGNORE,
          ".env.example": A_FILLED_IN_ENV_EXAMPLE,
        });

        await new GitignoreCheck().fix(aCheckContext(dir));

        expect(await ignoredByGit(dir, [".env.example"])).toEqual([".env.example"]);
      });
    });
  });
});

describe("MetaSchemasCheck", () => {
  it("passes when the project holds this CLI's schemas", async ({ dir }) => {
    await aNextProject(dir);
    await writeTheMetaSchemas(dir);

    const outcome = await new MetaSchemasCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("pass");
  });

  it("warns on a schema that differs from this CLI's", async ({ dir }) => {
    await aNextProject(dir);
    await writeTheMetaSchemas(dir);
    await write(dir, { [META_FLOW]: '{"title": "an older dialect"}\n' });

    const outcome = await new MetaSchemasCheck().run(aCheckContext(dir));

    expect(outcome).toMatchObject({ status: "warn", details: { outdated: [META_FLOW] } });
  });

  it("passes a schema that only differs in key order or formatting", async ({ dir }) => {
    await aNextProject(dir);
    await writeTheMetaSchemas(dir);
    const reordered = Object.fromEntries(
      Object.entries(thisCliMetaSchema(META_BRANDING).body).reverse(),
    );
    await write(dir, { [META_BRANDING]: JSON.stringify(reordered) });

    const outcome = await new MetaSchemasCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("pass");
  });

  describe("with a missing schema", () => {
    it("warns, naming it", async ({ dir }) => {
      await aNextProject(dir);
      await writeTheMetaSchemas(dir);
      await rm(join(dir, META_BRANDING));

      const outcome = await new MetaSchemasCheck().run(aCheckContext(dir));

      expect(outcome).toEqual(
        expect.objectContaining({
          status: "warn",
          details: { missing: [META_BRANDING], outdated: [] },
        }),
      );
    });

    it("names doctor --fix in the warning", async ({ dir }) => {
      await aNextProject(dir);
      await writeTheMetaSchemas(dir);
      await rm(join(dir, META_BRANDING));

      const outcome = await new MetaSchemasCheck().run(aCheckContext(dir));

      expect(outcome.message).toContain("doctor --fix writes this version's");
    });
  });

  describe("with schemas another CLI version wrote", () => {
    it("holds files that differ from this CLI's", async ({ dir }) => {
      await writeTheMetaSchemas(dir, "0.2.0");

      const held = await textOf(dir, META_BRANDING);

      expect(held).not.toBe(thisCliMetaSchema(META_BRANDING).contents);
    });

    it("passes them when only the version differs", async ({ dir }) => {
      await aNextProject(dir);
      await writeTheMetaSchemas(dir, "0.2.0");

      const outcome = await new MetaSchemasCheck().run(aCheckContext(dir));

      expect(outcome.status).toBe("pass");
    });
  });

  describe("with a schema it cannot read", () => {
    it("reports it as unreadable", async ({ dir }) => {
      await aNextProject(dir);
      await writeTheMetaSchemas(dir);
      await rm(join(dir, META_BRANDING));
      await mkdir(join(dir, META_BRANDING));

      const outcome = await new MetaSchemasCheck().run(aCheckContext(dir));

      expect(outcome).toEqual(
        expect.objectContaining({
          status: "warn",
          details: {
            missing: [],
            outdated: [],
            unreadable: [{ path: META_BRANDING, reason: "EISDIR" }],
          },
        }),
      );
    });

    it("does not offer doctor --fix for it", async ({ dir }) => {
      await aNextProject(dir);
      await writeTheMetaSchemas(dir);
      await rm(join(dir, META_BRANDING));
      await mkdir(join(dir, META_BRANDING));

      const outcome = await new MetaSchemasCheck().run(aCheckContext(dir));

      expect(outcome.message).not.toContain("doctor --fix");
    });

    it("still reports it after fix, which leaves it alone", async ({ dir }) => {
      await aNextProject(dir);
      await writeTheMetaSchemas(dir);
      await rm(join(dir, META_BRANDING));
      await mkdir(join(dir, META_BRANDING));

      await new MetaSchemasCheck().fix(aCheckContext(dir));

      expect(await new MetaSchemasCheck().run(aCheckContext(dir))).toMatchObject({
        details: { unreadable: [{ path: META_BRANDING, reason: "EISDIR" }] },
      });
    });
  });

  describe("with a schema that is a symlink", () => {
    /**
     * Fills `dir` with a project whose branding meta-schema is a symlink to
     * its secret.
     *
     * @param dir - The directory to fill.
     */
    const aLinkedSchema = async (dir: string): Promise<void> => {
      await aNextProject(dir);
      await writeTheMetaSchemas(dir);
      await rm(join(dir, META_BRANDING));
      await symlink("../secret", join(dir, META_BRANDING));
    };

    it("reports it as linked", async ({ dir }) => {
      await aLinkedSchema(dir);

      const outcome = await new MetaSchemasCheck().run(aCheckContext(dir));

      expect(outcome).toEqual(
        expect.objectContaining({
          status: "warn",
          details: { missing: [], outdated: [], linked: [META_BRANDING] },
        }),
      );
    });

    it("says it is a symbolic link", async ({ dir }) => {
      await aLinkedSchema(dir);

      const outcome = await new MetaSchemasCheck().run(aCheckContext(dir));

      expect(outcome.message).toContain(`${META_BRANDING} is a symbolic link`);
    });

    it("fix writes nothing through it", async ({ dir }) => {
      await aLinkedSchema(dir);
      const secret = await textOf(dir, SECRET_FILE);

      await new MetaSchemasCheck().fix(aCheckContext(dir));

      expect(await textOf(dir, SECRET_FILE)).toBe(secret);
    });

    it("fix leaves the symlink in place", async ({ dir }) => {
      await aLinkedSchema(dir);

      await new MetaSchemasCheck().fix(aCheckContext(dir));

      expect((await lstat(join(dir, META_BRANDING))).isSymbolicLink()).toBe(true);
    });
  });

  describe("with .zitadel/meta/ a symlink", () => {
    it("reports it as linked", async ({ dir, other }) => {
      await aNextProject(dir);
      await aNextProject(other);
      await symlink(other, join(dir, ".zitadel/meta"));

      const outcome = await new MetaSchemasCheck().run(aCheckContext(dir));

      expect(outcome).toEqual(
        expect.objectContaining({
          status: "warn",
          details: { missing: [], outdated: [], linked: [".zitadel/meta"] },
        }),
      );
    });

    it("fix writes nothing through it", async ({ dir, other }) => {
      await aNextProject(dir);
      await aNextProject(other);
      await symlink(other, join(dir, ".zitadel/meta"));
      const before = await readdir(other);

      await new MetaSchemasCheck().fix(aCheckContext(dir));

      expect(await readdir(other)).toEqual(before);
    });

    it("passes when its target holds this CLI's schemas", async ({ dir, other }) => {
      await aNextProject(dir);
      await writeTheMetaSchemas(other);
      await symlink(join(other, ".zitadel/meta"), join(dir, ".zitadel/meta"));

      const outcome = await new MetaSchemasCheck().run(aCheckContext(dir));

      expect(outcome.status).toBe("pass");
    });
  });

  describe("when the project pins a newer @zitadel/* version", () => {
    /**
     * Fills `dir` with a project pinning `@zitadel/sdk-next` 0.2.0 whose
     * flow-definition meta-schema is that version's.
     *
     * @param dir - The directory to fill.
     */
    const aNewerPin = async (dir: string): Promise<void> => {
      await aNextProject(dir);
      await writeTheMetaSchemas(dir);
      await write(dir, {
        [META_FLOW]: '{"title": "a newer dialect"}\n',
        "package.json": JSON.stringify({ dependencies: { "@zitadel/sdk-next": "0.2.0" } }),
      });
    };

    it("reports the newer pin", async ({ dir }) => {
      await aNewerPin(dir);

      const outcome = await new MetaSchemasCheck().run(aCheckContext(dir));

      expect(outcome.details).toMatchObject({
        outdated: [META_FLOW],
        newer_pin: { name: "@zitadel/sdk-next", version: "0.2.0" },
      });
    });

    it("does not offer doctor --fix", async ({ dir }) => {
      await aNewerPin(dir);

      const outcome = await new MetaSchemasCheck().run(aCheckContext(dir));

      expect(outcome.message).not.toContain("doctor --fix writes");
    });

    it("fix writes nothing", async ({ dir }) => {
      await aNewerPin(dir);

      await new MetaSchemasCheck().fix(aCheckContext(dir));

      expect(await textOf(dir, META_FLOW)).toBe('{"title": "a newer dialect"}\n');
    });
  });

  describe("fix", () => {
    it("writes the missing and outdated schemas, leaving the check passing", async ({ dir }) => {
      await aNextProject(dir);
      await writeTheMetaSchemas(dir);
      await rm(join(dir, META_BRANDING));
      await write(dir, { [META_FLOW]: "{}\n" });

      await new MetaSchemasCheck().fix(aCheckContext(dir));

      expect((await new MetaSchemasCheck().run(aCheckContext(dir))).status).toBe("pass");
    });

    it("leaves other files in .zitadel/meta/ alone", async ({ dir }) => {
      await aNextProject(dir);
      await writeTheMetaSchemas(dir);
      await rm(join(dir, META_BRANDING));
      await write(dir, { ".zitadel/meta/mine.json": '{"kept": true}\n' });

      await new MetaSchemasCheck().fix(aCheckContext(dir));

      expect(await textOf(dir, ".zitadel/meta/mine.json")).toBe('{"kept": true}\n');
    });

    it("creates .zitadel/meta/ when the project has none", async ({ dir }) => {
      await aNextProject(dir);

      await new MetaSchemasCheck().fix(aCheckContext(dir));

      expect((await new MetaSchemasCheck().run(aCheckContext(dir))).status).toBe("pass");
    });

    it("writes nothing on a dry run", async ({ dir }) => {
      await aNextProject(dir);

      await new MetaSchemasCheck().fix(aCheckContext(dir, { dryRun: true }));

      expect((await new MetaSchemasCheck().run(aCheckContext(dir))).status).toBe("warn");
    });
  });
});

describe("EnvExampleCheck", () => {
  it("fails when a key is missing", async ({ dir }) => {
    await aNextProject(dir);
    await write(dir, { ".env.example": "ZITADEL_PROJECT_ID=\n" });

    const outcome = await new EnvExampleCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("fail");
  });

  describe("fix", () => {
    it("appends the missing key", async ({ dir }) => {
      await aNextProject(dir);
      await write(dir, { ".env.example": "ZITADEL_PROJECT_ID=\n" });

      await new EnvExampleCheck().fix(aCheckContext(dir));

      expect(await textOf(dir, ".env.example")).toContain("ZITADEL_ISSUER=");
    });

    it("leaves the check passing", async ({ dir }) => {
      await aNextProject(dir);
      await write(dir, { ".env.example": "ZITADEL_PROJECT_ID=\n" });

      await new EnvExampleCheck().fix(aCheckContext(dir));

      expect((await new EnvExampleCheck().run(aCheckContext(dir))).status).toBe("pass");
    });

    it("writes nothing on a dry run", async ({ dir }) => {
      await aNextProject(dir);
      await write(dir, { ".env.example": "ZITADEL_PROJECT_ID=\n" });

      await new EnvExampleCheck().fix(aCheckContext(dir, { dryRun: true }));

      expect((await new EnvExampleCheck().run(aCheckContext(dir))).status).toBe("fail");
    });
  });
});

describe("FrameworkCheck", () => {
  it("passes when the detected framework matches the recorded one", async ({ dir }) => {
    await aNextProject(dir);

    const outcome = await new FrameworkCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("pass");
  });

  it("fails when the recorded framework disagrees with detection", async ({ dir }) => {
    await aNextProject(dir);
    await write(dir, {
      "zitadel.json": JSON.stringify({
        project: PROJECT_ID,
        server: "x",
        framework: { id: "vue" },
      }),
    });

    const outcome = await new FrameworkCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("fail");
  });

  describe("with an app below Next 15", () => {
    /**
     * Fills `dir` with a scaffolded app later downgraded to Next 14.
     *
     * @param dir - The directory to fill.
     */
    const aDowngradedApp = async (dir: string): Promise<void> => {
      await aNextProject(dir);
      await write(dir, {
        "package.json": JSON.stringify({
          name: "demo",
          dependencies: { next: "^14.2.0", "@zitadel/sdk-next": "latest" },
        }),
      });
    };

    it("fails, naming the version floor", async ({ dir }) => {
      await aDowngradedApp(dir);

      const outcome = await new FrameworkCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "fail",
        message: expect.stringContaining("below the supported floor"),
      });
    });

    it("carries the error's code and remedy for the doctor envelope", async ({ dir }) => {
      await aDowngradedApp(dir);

      const outcome = await new FrameworkCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        code: "E_UNSUPPORTED_PROJECT_SHAPE",
        hint: expect.stringContaining("Upgrade"),
      });
    });
  });
});

describe("DependencyCheck", () => {
  it("passes when a @zitadel package is declared", async ({ dir }) => {
    await aNextProject(dir);

    const outcome = await new DependencyCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("pass");
  });

  it("fails when no @zitadel package is present", async ({ dir }) => {
    await aNextProject(dir);
    await write(dir, {
      "package.json": JSON.stringify({ name: "demo", dependencies: { next: "^15" } }),
    });

    const outcome = await new DependencyCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("fail");
  });

  it.for(SDK_PACKAGES_BY_FRAMEWORK)(
    "requires the %s SDK package, not just the CLI",
    async ([, dependencies, missing], { dir }) => {
      await aNextProject(dir);
      await write(dir, {
        "package.json": JSON.stringify({
          name: "demo",
          dependencies,
          devDependencies: { "@zitadel/cli": CHECK_CLI_VERSION },
        }),
      });

      const outcome = await new DependencyCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "fail",
        message: `package.json does not declare ${missing}, which the app imports`,
      });
    },
  );

  it("fails a meta-framework app that lacks the widget SDK its pages import", async ({ dir }) => {
    await aNextProject(dir);
    await write(dir, {
      "package.json": JSON.stringify({
        name: "demo",
        dependencies: { "@sveltejs/kit": "^3", svelte: "^5", "@zitadel/sdk-sveltekit": "latest" },
      }),
    });

    const outcome = await new DependencyCheck().run(aCheckContext(dir));

    expect(outcome.message).toBe(
      "package.json does not declare @zitadel/sdk-svelte, which the app imports",
    );
  });

  it("passes a meta-framework app that declares both of its SDKs", async ({ dir }) => {
    await aNextProject(dir);
    await write(dir, {
      "package.json": JSON.stringify({
        name: "demo",
        dependencies: {
          "@sveltejs/kit": "^3",
          svelte: "^5",
          "@zitadel/sdk-sveltekit": "latest",
          "@zitadel/sdk-svelte": "latest",
        },
      }),
    });

    const outcome = await new DependencyCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("pass");
  });

  describe("fix", () => {
    it.for([
      ["kept only the CLI in its place", { "@zitadel/cli": CHECK_CLI_VERSION }],
      ["declares no @zitadel package", {}],
    ] as const)(
      "re-adds the SDK of an app that %s, leaving the check passing",
      async ([, devDependencies], { dir }) => {
        await aNextProject(dir);
        await write(dir, {
          "package.json": JSON.stringify({
            name: "demo",
            dependencies: { next: "^15" },
            devDependencies,
          }),
        });

        await new DependencyCheck().fix(aCheckContext(dir));

        expect((await new DependencyCheck().run(aCheckContext(dir))).status).toBe("pass");
      },
    );

    describe("with an edited middleware.ts on Next 16", () => {
      /**
       * Fills `dir` with a Next 16 app missing its SDK, whose middleware.ts
       * the developer edited.
       *
       * @param dir - The directory to fill.
       */
      const anEditedBoundary = async (dir: string): Promise<void> => {
        await aNextProject(dir);
        await write(dir, {
          "package.json": JSON.stringify({
            name: "demo",
            dependencies: { next: "^16" },
            devDependencies: { "@zitadel/cli": CHECK_CLI_VERSION },
          }),
          [MIDDLEWARE]: EDITED_MIDDLEWARE,
        });
        await writeScaffold(dir, {
          files: { [MIDDLEWARE]: { hash: EDITED_HASH, class: "infrastructure" } },
        });
      };

      it("adds the SDK", async ({ dir }) => {
        await anEditedBoundary(dir);

        await new DependencyCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, "package.json")).toContain("@zitadel/sdk-next");
      });

      it("leaves middleware.ts as it is", async ({ dir }) => {
        await anEditedBoundary(dir);

        await new DependencyCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, MIDDLEWARE)).toBe(EDITED_MIDDLEWARE);
      });

      it("does not create proxy.ts beside it", async ({ dir }) => {
        await anEditedBoundary(dir);

        await new DependencyCheck().fix(aCheckContext(dir));

        expect(existsSync(join(dir, PROXY))).toBe(false);
      });
    });

    describe("with a Next 16 app without a boundary", () => {
      /**
       * Fills `dir` with a Next 16 app missing its SDK and its boundary.
       *
       * @param dir - The directory to fill.
       */
      const aBareNext16App = async (dir: string): Promise<void> => {
        await aNextProject(dir);
        await write(dir, {
          "package.json": JSON.stringify({ name: "demo", dependencies: { next: "^16" } }),
        });
        await rm(join(dir, MIDDLEWARE));
      };

      it("writes proxy.ts", async ({ dir }) => {
        await aBareNext16App(dir);

        await new DependencyCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, PROXY)).toContain("export function proxy(");
      });

      it("writes no middleware.ts", async ({ dir }) => {
        await aBareNext16App(dir);

        await new DependencyCheck().fix(aCheckContext(dir));

        expect(existsSync(join(dir, MIDDLEWARE))).toBe(false);
      });
    });
  });
});

describe("ManagedFilesCheck", () => {
  describe("without a manifest", () => {
    it("passes a healthy scaffold", async ({ dir }) => {
      await aNextProject(dir);

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome.status).toBe("pass");
    });

    it("checks the files the templates write", async ({ dir }) => {
      await aNextProject(dir);

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome.details).toMatchObject({ mode: "template" });
    });

    it("checks the five files a pre-existing app was given", async ({ dir }) => {
      await aNextProject(dir);

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome.details).toHaveProperty(["files", "length"], 5);
    });

    it("does not demand the framework home page, which only a fresh app is given", async ({
      dir,
    }) => {
      await aNextProject(dir);

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome.details).toMatchObject({
        files: expect.not.arrayContaining([expect.objectContaining({ path: HOME_PAGE })]),
      });
    });

    it("fails when an infrastructure file is missing", async ({ dir }) => {
      await aNextProject(dir);
      await rm(join(dir, MIDDLEWARE));

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "fail",
        message: expect.stringContaining(MIDDLEWARE),
      });
    });

    it("warns, rather than failing, when a presentation page is missing", async ({ dir }) => {
      await aNextProject(dir);
      await rm(join(dir, LOGIN_PAGE));

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringContaining(LOGIN_PAGE),
      });
    });

    it("passes a page the user adopted by removing its marker", async ({ dir }) => {
      await aNextProject(dir);
      await write(dir, { [REGISTER_PAGE]: "export default function Mine() {}\n" });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome.status).toBe("pass");
    });

    it("classifies a page without the marker as adopted", async ({ dir }) => {
      await aNextProject(dir);
      await write(dir, { [REGISTER_PAGE]: "export default function Mine() {}\n" });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome.details).toMatchObject({
        files: expect.arrayContaining([
          expect.objectContaining({ path: REGISTER_PAGE, state: "adopted" }),
        ]),
      });
    });

    it("warns instead of failing when nothing can be enumerated", async ({ dir }) => {
      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringContaining("Could not enumerate"),
      });
    });

    it("passes a boundary the user adopted", async ({ dir }) => {
      await aNextProject(dir);
      await write(dir, { [MIDDLEWARE]: "export function middleware() {}\n" });
      await writeScaffold(dir);

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome.status).toBe("pass");
    });

    it("ignores a user-owned proxy.ts on Next 15, where it is no reserved convention", async ({
      dir,
    }) => {
      await aNextProject(dir);
      await write(dir, { [PROXY]: "export function proxy() { /* user-owned */ }\n" });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "pass",
        message: expect.not.stringContaining("conflicting"),
      });
    });
  });

  describe("with a malformed manifest", () => {
    it.for([
      ["an entry is malformed", { files: { [MIDDLEWARE]: null } }],
      ["its files record is an array", { files: [] }],
    ] as const)("degrades to template mode when %s", async ([, scaffold], { dir }) => {
      await aNextProject(dir);
      await writeScaffold(dir, scaffold);

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "pass",
        details: { mode: "template", files: expect.arrayContaining([expect.anything()]) },
      });
    });
  });

  describe("with a manifest", () => {
    it("passes, checking only the files the manifest records", async ({ dir }) => {
      await aNextProject(dir);
      await writeScaffold(dir, {
        files: {
          [MIDDLEWARE]: { hash: hashScaffoldFile(MANAGED_MIDDLEWARE), class: "infrastructure" },
        },
      });
      await rm(join(dir, "custom-elements.d.ts"));

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "pass",
        details: { mode: "manifest", files: [{ path: MIDDLEWARE, state: "pristine" }] },
      });
    });

    it("classifies a file whose hash differs from the recorded one as edited", async ({ dir }) => {
      await aNextProject(dir);
      await writeScaffold(dir, {
        files: { [MIDDLEWARE]: { hash: EDITED_HASH, class: "infrastructure" } },
      });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({ status: "pass", details: { files: [{ state: "edited" }] } });
    });

    it("fails on missing infrastructure it records", async ({ dir }) => {
      await aNextProject(dir);
      await writeScaffold(dir, {
        files: { [MIDDLEWARE]: { hash: EDITED_HASH, class: "infrastructure" } },
      });
      await rm(join(dir, MIDDLEWARE));

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome.status).toBe("fail");
    });

    it("warns about a missing home page a fresh scaffold recorded", async ({ dir }) => {
      await aNextProject(dir);
      await writeScaffold(dir, {
        files: { [HOME_PAGE]: { hash: EDITED_HASH, class: "presentation" } },
        scaffolded_framework: true,
      });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome.status).toBe("warn");
    });
  });

  describe("with the dev script", () => {
    it("passes a dev script that serves the registered port", async ({ dir }) => {
      await aNextProjectWithDevScript(dir, "next dev --port 3456", 3456);

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome.status).toBe("pass");
    });

    it("flags a dev script edited to a port the project does not allow", async ({ dir }) => {
      await aNextProjectWithDevScript(dir, "next dev --port 4000", 3456);

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringContaining("unapplied managed config edit(s): package.json"),
      });
    });

    it("warns about a dev script that declares no port", async ({ dir }) => {
      await aNextProjectWithDevScript(dir, "next dev", 3456);

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome.status).toBe("warn");
    });

    it("warns, rather than failing, when only the convenience dev script is missing", async ({
      dir,
    }) => {
      await anAngularProject(dir);
      await write(dir, {
        "package.json": JSON.stringify({
          name: "demo",
          dependencies: { "@angular/core": "^19.0.0", "@zitadel/sdk-angular": "latest" },
        }),
      });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringContaining("unapplied managed config edit(s): package.json"),
      });
    });
  });

  describe("with an Angular project's config wirings", () => {
    it("passes, saying its wirings were verified", async ({ dir }) => {
      await anAngularProject(dir);

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "pass",
        message: expect.stringContaining("wirings verified"),
      });
    });

    it("fails when a wiring is detached though every marked file is pristine", async ({ dir }) => {
      await anAngularProject(dir);
      await write(dir, {
        "angular.json": JSON.stringify({
          projects: { demo: { architect: { serve: { options: { port: 4200 } } } } },
        }),
      });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "fail",
        message: expect.stringContaining("detached managed config wiring: angular.json"),
      });
    });

    it("fails when a wiring's host config file is deleted outright", async ({ dir }) => {
      await anAngularProject(dir);
      await rm(join(dir, "angular.json"));

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "fail",
        message: expect.stringContaining("detached managed config wiring: angular.json"),
      });
    });

    it("warns that a wiring is unverifiable when two projects leave no default to patch", async ({
      dir,
    }) => {
      await anAngularProject(dir);
      await write(dir, { "angular.json": JSON.stringify({ projects: { a: {}, b: {} } }) });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringMatching(/unverifiable managed config wiring[\s\S]*angular\.json/),
      });
    });

    it("warns while the managed proxy lacks the session-cookie hooks", async ({ dir }) => {
      await anAngularProject(dir);
      await write(dir, { [ANGULAR_PROXY]: bearerOnlyProxyConf() });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringContaining(
          "unapplied managed config edit(s): proxy.conf.cjs (doctor --fix applies them)",
        ),
      });
    });

    it("fails while the managed proxy knows only the bare exchange", async ({ dir }) => {
      await anAngularProject(dir);
      await write(dir, { [ANGULAR_PROXY]: aV2ProxyConf() });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "fail",
        message: expect.stringContaining("detached managed config wiring: proxy.conf.cjs"),
      });
    });

    it("fails on the session-cookie hooks from before ADR 083, offering doctor --fix", async ({
      dir,
    }) => {
      await anAngularProject(dir);
      await write(dir, { [ANGULAR_PROXY]: v1ProxyConf() });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "fail",
        message: expect.stringMatching(
          /outdated managed config wiring: proxy\.conf\.cjs[\s\S]*doctor --fix updates them/,
        ),
      });
    });

    it("fails on hooks from before ADR 083 changed by hand, leaving them to the developer", async ({
      dir,
    }) => {
      await anAngularProject(dir);
      await write(dir, { [ANGULAR_PROXY]: aHandChangedV1ProxyConf() });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "fail",
        message: expect.stringContaining("must be updated by hand"),
      });
    });

    it("warns that the session-cookie hooks need adding by hand to a proxy changed since", async ({
      dir,
    }) => {
      await anAngularProject(dir);
      await write(dir, { [ANGULAR_PROXY]: aReformattedBearerOnlyProxyConf() });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringMatching(
          /unverifiable managed config wiring[\s\S]*session-cookie hooks \(ADR 073\) must be added by hand/,
        ),
      });
    });

    it("warns when an unrecognized legacy proxy may over-forward the project secret", async ({
      dir,
    }) => {
      await anAngularProject(dir);
      await write(dir, { [ANGULAR_PROXY]: anUnguardedProxyConf() });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringMatching(
          /proxy\.conf\.cjs[\s\S]*may forward ZITADEL_PROJECT_SECRET outside POST \/sessions\/exchange/,
        ),
      });
    });
  });

  describe("with a Vite project's dev proxy", () => {
    it("passes a proxy that reads the server's address from ZITADEL_URL", async ({ dir }) => {
      await aReactProject(dir, viteConfig(CLOUD));

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome.status).toBe("pass");
    });

    it("warns, offering doctor --fix, on a proxy that fixes the server's address", async ({
      dir,
    }) => {
      await aReactProject(dir, withFixedAddress(viteConfig(CLOUD), CLOUD));

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringContaining(
          "unapplied managed config edit(s): vite.config.ts (doctor --fix applies them)",
        ),
      });
    });

    it("warns, naming both addresses and the file, while .env.development.local names another server", async ({
      dir,
    }) => {
      await aReactProject(dir, withFixedAddress(viteConfig(CLOUD), CLOUD), {
        ".env.development.local": `ZITADEL_URL=${OTHER_SERVER}\n`,
      });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringContaining(
          `fixes ${CLOUD}, but .env.development.local sets ZITADEL_URL to ${OTHER_SERVER}`,
        ),
      });
    });

    it("warns, naming the server zitadel.json names, while .env.development.local does not set one yet", async ({
      dir,
    }) => {
      await aReactProject(dir, withFixedAddress(viteConfig(CLOUD), OTHER_SERVER), {
        ".env.development.local": "ZITADEL_PROJECT_ID=proj-001\n",
      });

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringContaining(
          `fixes ${OTHER_SERVER}, but zitadel.json names ${CLOUD}, which doctor --fix writes to .env.development.local as ZITADEL_URL`,
        ),
      });
    });

    it("warns, not fails, on a proxy whose bearer hook was changed by hand", async ({ dir }) => {
      await aReactProject(
        dir,
        withFixedAddress(viteConfig(CLOUD), CLOUD).replace(
          'proxyReq.setHeader("authorization", bearer);',
          'proxyReq.setHeader("authorization", bearer);\n            console.debug("exchange");',
        ),
      );

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringContaining("was changed since zitadel setup wrote it"),
      });
    });

    it("says why a config it cannot read is unverifiable once", async ({ dir }) => {
      await aReactProject(dir, "module.exports = () => ({});\n");

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome.message.match(/vite\.config\.ts \(/g)).toHaveLength(1);
    });
  });

  describe("with Next's request boundary", () => {
    /**
     * Fills `dir` with a Next 16 app whose manifest records a pristine
     * middleware.ts, the boundary Next 16 retired.
     *
     * @param dir - The directory to fill.
     */
    const aPristineRetiredBoundary = async (dir: string): Promise<void> => {
      await aNextProject(dir);
      await write(dir, { "package.json": JSON.stringify(NEXT_16_PACKAGE) });
      await writeScaffold(dir, {
        files: {
          [MIDDLEWARE]: { hash: hashScaffoldFile(MANAGED_MIDDLEWARE), class: "infrastructure" },
        },
      });
    };

    /**
     * Fills `dir` with a Next 16 app that kept an edited middleware.ts, and is
     * missing its sign-in page.
     *
     * @param dir - The directory to fill.
     */
    const aConflictingBoundary = async (dir: string): Promise<void> => {
      await aNextProject(dir);
      await write(dir, {
        "package.json": JSON.stringify(NEXT_16_PACKAGE),
        [MIDDLEWARE]: EDITED_MIDDLEWARE,
      });
      await writeScaffold(dir, {
        files: {
          [MIDDLEWARE]: { hash: EDITED_HASH, class: "infrastructure" },
          [LOGIN_PAGE]: { hash: EDITED_HASH, class: "presentation" },
        },
      });
      await rm(join(dir, LOGIN_PAGE));
    };

    it("warns about a pristine retired middleware.ts left over", async ({ dir }) => {
      await aPristineRetiredBoundary(dir);

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringContaining("retired boundary middleware.ts left over"),
      });
    });

    it("fails on conflicting request boundaries, naming middleware.ts", async ({ dir }) => {
      await aConflictingBoundary(dir);

      const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "fail",
        message: expect.stringMatching(/conflicting request boundaries[\s\S]*middleware\.ts/),
      });
    });

    describe("fix, migrating a pristine retired boundary", () => {
      it("removes middleware.ts", async ({ dir }) => {
        await aPristineRetiredBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(existsSync(join(dir, MIDDLEWARE))).toBe(false);
      });

      it("installs proxy.ts", async ({ dir }) => {
        await aPristineRetiredBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, PROXY)).toContain(MANAGED_MARKER);
      });

      it("drops middleware.ts from the manifest", async ({ dir }) => {
        await aPristineRetiredBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, STATE_FILE)).not.toHaveProperty([
          "scaffold",
          "files",
          MIDDLEWARE,
        ]);
      });

      it("records proxy.ts as infrastructure in the manifest", async ({ dir }) => {
        await aPristineRetiredBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, STATE_FILE)).toHaveProperty(
          ["scaffold", "files", PROXY, "class"],
          "infrastructure",
        );
      });

      it("leaves the check passing", async ({ dir }) => {
        await aPristineRetiredBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect((await new ManagedFilesCheck().run(aCheckContext(dir))).status).toBe("pass");
      });
    });

    describe("fix, beside an edited middleware.ts", () => {
      it("restores the unrelated missing page", async ({ dir }) => {
        await aConflictingBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, LOGIN_PAGE)).toContain(MANAGED_MARKER);
      });

      it("creates no proxy.ts, which Next refuses beside middleware.ts", async ({ dir }) => {
        await aConflictingBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(existsSync(join(dir, PROXY))).toBe(false);
      });

      it("leaves the edited middleware.ts as it is", async ({ dir }) => {
        await aConflictingBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, MIDDLEWARE)).toBe(EDITED_MIDDLEWARE);
      });

      it("leaves the check failing", async ({ dir }) => {
        await aConflictingBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect((await new ManagedFilesCheck().run(aCheckContext(dir))).status).toBe("fail");
      });
    });

    describe("fix, across a Next 15 to 16 upgrade", () => {
      /**
       * Fills `dir` with an app scaffolded on Next 15, whose manifest demands
       * middleware.ts, then upgraded to Next 16 with the boundary missing.
       *
       * @param dir - The directory to fill.
       */
      const anUpgradedApp = async (dir: string): Promise<void> => {
        await aNextProject(dir);
        await write(dir, { "package.json": JSON.stringify(NEXT_16_PACKAGE) });
        await writeScaffold(dir, {
          files: { [MIDDLEWARE]: { hash: EDITED_HASH, class: "infrastructure" } },
        });
        await rm(join(dir, MIDDLEWARE));
      };

      it("restores the current boundary, proxy.ts", async ({ dir }) => {
        await anUpgradedApp(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, PROXY)).toContain(MANAGED_MARKER);
      });

      it("drops middleware.ts from the manifest", async ({ dir }) => {
        await anUpgradedApp(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, STATE_FILE)).not.toHaveProperty([
          "scaffold",
          "files",
          MIDDLEWARE,
        ]);
      });

      it("records proxy.ts as infrastructure in the manifest", async ({ dir }) => {
        await anUpgradedApp(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, STATE_FILE)).toHaveProperty(
          ["scaffold", "files", PROXY, "class"],
          "infrastructure",
        );
      });

      it("leaves the check passing in manifest mode", async ({ dir }) => {
        await anUpgradedApp(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await new ManagedFilesCheck().run(aCheckContext(dir))).toMatchObject({
          status: "pass",
          details: { mode: "manifest" },
        });
      });
    });

    describe("fix, while a boundary conflict is unresolved in a pre-manifest app", () => {
      /**
       * Fills `dir` with a pre-manifest app upgraded to Next 16 that kept an
       * edited middleware.ts.
       *
       * @param dir - The directory to fill.
       */
      const anUnresolvedConflict = async (dir: string): Promise<void> => {
        await aNextProject(dir);
        await write(dir, {
          "package.json": JSON.stringify(NEXT_16_PACKAGE),
          [MIDDLEWARE]: EDITED_MIDDLEWARE,
        });
        await writeScaffold(dir);
      };

      /**
       * Fills `dir` as {@link anUnresolvedConflict}, repairs it once, then
       * resolves the conflict as a developer would: middleware.ts gives way
       * to a managed proxy.ts.
       *
       * @param dir - The directory to fill.
       */
      const aResolvedConflict = async (dir: string): Promise<void> => {
        await anUnresolvedConflict(dir);
        await new ManagedFilesCheck().fix(aCheckContext(dir));
        await rm(join(dir, MIDDLEWARE));
        await write(dir, { [PROXY]: `${MANAGED_MARKER}\nexport function proxy() {}\n` });
      };

      it("creates no proxy.ts", async ({ dir }) => {
        await anUnresolvedConflict(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(existsSync(join(dir, PROXY))).toBe(false);
      });

      it("writes no manifest", async ({ dir }) => {
        await anUnresolvedConflict(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, STATE_FILE)).not.toHaveProperty("scaffold");
      });

      it("leaves the check failing", async ({ dir }) => {
        await anUnresolvedConflict(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect((await new ManagedFilesCheck().run(aCheckContext(dir))).status).toBe("fail");
      });

      it("records the boundary once the conflict is resolved", async ({ dir }) => {
        await aResolvedConflict(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, STATE_FILE)).toHaveProperty(
          ["scaffold", "files", PROXY, "class"],
          "infrastructure",
        );
      });

      it("passes once the conflict is resolved", async ({ dir }) => {
        await aResolvedConflict(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect((await new ManagedFilesCheck().run(aCheckContext(dir))).status).toBe("pass");
      });
    });
  });

  describe("fix", () => {
    it("restores a deleted boundary without a manifest", async ({ dir }) => {
      await aNextProject(dir);
      await rm(join(dir, MIDDLEWARE));

      await new ManagedFilesCheck().fix(aCheckContext(dir));

      expect(await textOf(dir, MIDDLEWARE)).toContain(MANAGED_MARKER);
    });

    it("leaves an edited page untouched without a manifest", async ({ dir }) => {
      await aNextProject(dir);
      const editedLogin = `${MANAGED_MARKER}\nexport default function L() { return "custom"; }\n`;
      await write(dir, { [LOGIN_PAGE]: editedLogin });
      await rm(join(dir, MIDDLEWARE));

      await new ManagedFilesCheck().fix(aCheckContext(dir));

      expect(await textOf(dir, LOGIN_PAGE)).toBe(editedLogin);
    });

    it("leaves the check passing after restoring a boundary without a manifest", async ({
      dir,
    }) => {
      await aNextProject(dir);
      await rm(join(dir, MIDDLEWARE));

      await new ManagedFilesCheck().fix(aCheckContext(dir));

      expect((await new ManagedFilesCheck().run(aCheckContext(dir))).status).toBe("pass");
    });

    it("never re-pins an already-declared SDK dependency version", async ({ dir }) => {
      await aNextProject(dir);
      await write(dir, {
        "package.json": JSON.stringify({
          name: "demo",
          dependencies: { next: "^15", "@zitadel/sdk-next": "user-pinned-0.0.1" },
        }),
      });
      await rm(join(dir, MIDDLEWARE));

      await new ManagedFilesCheck().fix(aCheckContext(dir));

      expect(await readJson(dir, "package.json")).toHaveProperty(
        ["dependencies", "@zitadel/sdk-next"],
        "user-pinned-0.0.1",
      );
    });

    it("restores the boundary of an app with a pinned SDK", async ({ dir }) => {
      await aNextProject(dir);
      await write(dir, {
        "package.json": JSON.stringify({
          name: "demo",
          dependencies: { next: "^15", "@zitadel/sdk-next": "user-pinned-0.0.1" },
        }),
      });
      await rm(join(dir, MIDDLEWARE));

      await new ManagedFilesCheck().fix(aCheckContext(dir));

      expect(await textOf(dir, MIDDLEWARE)).toContain(MANAGED_MARKER);
    });

    describe("with missing infrastructure the manifest records", () => {
      /**
       * Fills `dir` with a project whose manifest records middleware.ts,
       * which is missing.
       *
       * @param dir - The directory to fill.
       */
      const aMissingBoundary = async (dir: string): Promise<void> => {
        await aNextProject(dir);
        await writeScaffold(dir, {
          files: { [MIDDLEWARE]: { hash: EDITED_HASH, class: "infrastructure" } },
        });
        await rm(join(dir, MIDDLEWARE));
      };

      it("restores it", async ({ dir }) => {
        await aMissingBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, MIDDLEWARE)).toContain(MANAGED_MARKER);
      });

      it("refreshes its recorded hash", async ({ dir }) => {
        await aMissingBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, STATE_FILE)).toHaveProperty(
          ["scaffold", "files", MIDDLEWARE, "hash"],
          hashScaffoldFile(await textOf(dir, MIDDLEWARE)),
        );
      });

      it("leaves it passing as pristine", async ({ dir }) => {
        await aMissingBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await new ManagedFilesCheck().run(aCheckContext(dir))).toMatchObject({
          status: "pass",
          details: {
            files: expect.arrayContaining([
              expect.objectContaining({ path: MIDDLEWARE, state: "pristine" }),
            ]),
          },
        });
      });

      it("invents no framework home page the manifest does not say was scaffolded", async ({
        dir,
      }) => {
        await aMissingBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(existsSync(join(dir, HOME_PAGE))).toBe(false);
      });

      it("writes no file on a dry run", async ({ dir }) => {
        await aMissingBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir, { dryRun: true }));

        expect(existsSync(join(dir, MIDDLEWARE))).toBe(false);
      });

      it("leaves the manifest as it was on a dry run", async ({ dir }) => {
        await aMissingBoundary(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir, { dryRun: true }));

        expect(await readJson(dir, STATE_FILE)).toHaveProperty(
          ["scaffold", "files", MIDDLEWARE, "hash"],
          EDITED_HASH,
        );
      });
    });

    describe("with edited and adopted pages the manifest records", () => {
      const editedLogin = `${MANAGED_MARKER}\nexport default function L() { return "edited"; }\n`;
      const adoptedRegister = "export default function Own() {}\n";

      /**
       * Fills `dir` with a project whose manifest records an edited sign-in
       * page, an adopted sign-up page and a missing middleware.ts.
       *
       * @param dir - The directory to fill.
       */
      const aMixedScaffold = async (dir: string): Promise<void> => {
        await aNextProject(dir);
        await write(dir, { [LOGIN_PAGE]: editedLogin, [REGISTER_PAGE]: adoptedRegister });
        await writeScaffold(dir, {
          files: {
            [MIDDLEWARE]: { hash: EDITED_HASH, class: "infrastructure" },
            [LOGIN_PAGE]: { hash: EDITED_HASH, class: "presentation" },
            [REGISTER_PAGE]: { hash: EDITED_HASH, class: "presentation" },
          },
        });
        await rm(join(dir, MIDDLEWARE));
      };

      it.for([
        ["an edited", LOGIN_PAGE, editedLogin],
        ["an adopted", REGISTER_PAGE, adoptedRegister],
      ] as const)("never touches %s page", async ([, path, contents], { dir }) => {
        await aMixedScaffold(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, path)).toBe(contents);
      });

      it("still restores the missing boundary beside them", async ({ dir }) => {
        await aMixedScaffold(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, MIDDLEWARE)).toContain(MANAGED_MARKER);
      });
    });

    describe("on a pre-manifest app", () => {
      /**
       * Fills `dir` with an app whose state has no scaffold section, whose
       * sign-up page the user adopted and whose boundary is missing.
       *
       * @param dir - The directory to fill.
       */
      const aPreManifestApp = async (dir: string): Promise<void> => {
        await aNextProject(dir);
        await writeScaffold(dir);
        await write(dir, { [REGISTER_PAGE]: "export default function Own() {}\n" });
        await rm(join(dir, MIDDLEWARE));
      };

      it("materializes a manifest recording each file's class", async ({ dir }) => {
        await aPreManifestApp(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, STATE_FILE)).toMatchObject({
          scaffold: {
            files: {
              [MIDDLEWARE]: { class: "infrastructure" },
              [LOGIN_PAGE]: { class: "presentation" },
            },
          },
        });
      });

      it.for([
        ["an adopted page", REGISTER_PAGE],
        ["the conditionally scaffolded home page", HOME_PAGE],
      ] as const)("leaves %s out of the manifest", async ([, path], { dir }) => {
        await aPreManifestApp(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, STATE_FILE)).not.toHaveProperty(["scaffold", "files", path]);
      });

      it("checks against the manifest afterwards", async ({ dir }) => {
        await aPreManifestApp(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await new ManagedFilesCheck().run(aCheckContext(dir))).toMatchObject({
          status: "pass",
          details: { mode: "manifest" },
        });
      });

      it("writes no manifest when an infrastructure file was adopted", async ({ dir }) => {
        await aNextProject(dir);
        await write(dir, { [MIDDLEWARE]: "export function middleware() {}\n" });
        await writeScaffold(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, STATE_FILE)).not.toHaveProperty("scaffold");
      });

      it("leaves an app with an adopted infrastructure file passing", async ({ dir }) => {
        await aNextProject(dir);
        await write(dir, { [MIDDLEWARE]: "export function middleware() {}\n" });
        await writeScaffold(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect((await new ManagedFilesCheck().run(aCheckContext(dir))).status).toBe("pass");
      });
    });

    describe("with a dev script that declares no port", () => {
      it("restores the registered port, not the detected fallback", async ({ dir }) => {
        await aNextProjectWithDevScript(dir, "next dev", 3456);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, "package.json")).toHaveProperty(
          ["scripts", "dev"],
          "next dev --port 3456",
        );
      });

      it("leaves the check passing", async ({ dir }) => {
        await aNextProjectWithDevScript(dir, "next dev", 3456);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect((await new ManagedFilesCheck().run(aCheckContext(dir))).status).toBe("pass");
      });
    });

    describe("with an Angular project's config wirings", () => {
      it("re-applies a detached wiring", async ({ dir }) => {
        await anAngularProject(dir);
        await write(dir, {
          "angular.json": JSON.stringify({
            projects: { demo: { architect: { serve: { options: { port: 4200 } } } } },
          }),
        });

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, "angular.json")).toHaveProperty(
          ["projects", "demo", "architect", "serve", "options", "proxyConfig"],
          ANGULAR_PROXY,
        );
      });

      it("leaves the check passing after re-applying a detached wiring", async ({ dir }) => {
        await anAngularProject(dir);
        await write(dir, {
          "angular.json": JSON.stringify({
            projects: { demo: { architect: { serve: { options: { port: 4200 } } } } },
          }),
        });

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect((await new ManagedFilesCheck().run(aCheckContext(dir))).status).toBe("pass");
      });

      it.for([
        ["a proxy lacking the session-cookie hooks", bearerOnlyProxyConf],
        ["a proxy knowing only the bare exchange", aV2ProxyConf],
        ["the session-cookie hooks from before ADR 083", v1ProxyConf],
      ] as const)("replaces %s with the current template", async ([, proxy], { dir }) => {
        await anAngularProject(dir);
        await write(dir, { [ANGULAR_PROXY]: proxy() });

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, ANGULAR_PROXY)).toBe(proxyConfTemplate());
      });

      it.for([
        ["a proxy lacking the session-cookie hooks", bearerOnlyProxyConf],
        ["a proxy knowing only the bare exchange", aV2ProxyConf],
        ["the session-cookie hooks from before ADR 083", v1ProxyConf],
      ] as const)("leaves the check passing after replacing %s", async ([, proxy], { dir }) => {
        await anAngularProject(dir);
        await write(dir, { [ANGULAR_PROXY]: proxy() });

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect((await new ManagedFilesCheck().run(aCheckContext(dir))).status).toBe("pass");
      });

      it.for([
        ["hooks from before ADR 083 changed by hand", aHandChangedV1ProxyConf],
        ["a bearer-only proxy changed since", aReformattedBearerOnlyProxyConf],
      ] as const)("leaves %s as they are", async ([, proxy], { dir }) => {
        await anAngularProject(dir);
        await write(dir, { [ANGULAR_PROXY]: proxy() });

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, ANGULAR_PROXY)).toBe(proxy());
      });
    });

    describe("with a Vite proxy that fixes the server's address", () => {
      it("moves the proxy onto ZITADEL_URL, keeping the address as its fallback", async ({
        dir,
      }) => {
        await aReactProject(dir, withFixedAddress(viteConfig(CLOUD), CLOUD));

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(withoutBlankLines(await textOf(dir, VITE_CONFIG))).toBe(
          withoutBlankLines(viteConfig(CLOUD)),
        );
      });

      it.for([".env.local", ".env.development.local"])(
        "leaves the ZITADEL_URL in %s as it was",
        async (file, { dir }) => {
          await aReactProject(dir, withFixedAddress(viteConfig(CLOUD), CLOUD));

          await new ManagedFilesCheck().fix(aCheckContext(dir));

          expect((await textOf(dir, file)).match(/^ZITADEL_URL=.*$/gm)).toEqual([
            `ZITADEL_URL=${CLOUD}`,
          ]);
        },
      );

      it("moves a proxy whose env files set ZITADEL_URL empty, so the app keeps its address", async ({
        dir,
      }) => {
        await aReactProject(dir, withFixedAddress(viteConfig(CLOUD), CLOUD), {
          ".env.development.local": "ZITADEL_URL=\n",
        });

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(withoutBlankLines(await textOf(dir, VITE_CONFIG))).toBe(
          withoutBlankLines(viteConfig(CLOUD)),
        );
      });

      it("leaves the check passing", async ({ dir }) => {
        await aReactProject(dir, withFixedAddress(viteConfig(CLOUD), CLOUD));

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect((await new ManagedFilesCheck().run(aCheckContext(dir))).status).toBe("pass");
      });

      it("changes nothing when run a second time", async ({ dir }) => {
        await aReactProject(dir, withFixedAddress(viteConfig(CLOUD), CLOUD));
        await new ManagedFilesCheck().fix(aCheckContext(dir));
        const once = await textOf(dir, VITE_CONFIG);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, VITE_CONFIG)).toBe(once);
      });

      it.for([
        ["while .env.development.local names another server", CLOUD, OTHER_SERVER],
        ["once its target was changed to another server", OTHER_SERVER, CLOUD],
      ] as const)("leaves the proxy as it is %s", async ([, target, envServer], { dir }) => {
        const config = withFixedAddress(viteConfig(CLOUD), target);
        await aReactProject(dir, config, {
          ".env.development.local": `ZITADEL_URL=${envServer}\n`,
        });

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, VITE_CONFIG)).toBe(config);
      });

      it("leaves a literal put back after the move as it is", async ({ dir }) => {
        const pinned = withFixedAddress(viteConfig(CLOUD), CLOUD).replace(
          "zitadel:proxy:v3",
          "zitadel:proxy:v4",
        );
        await aReactProject(dir, pinned);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, VITE_CONFIG)).toBe(pinned);
      });
    });

    describe("with a fresh scaffold the manifest recorded", () => {
      /**
       * Fills `dir` with a project whose manifest records a fresh scaffold's
       * home page, missing, and no route layouts, as an older setup wrote.
       *
       * @param dir - The directory to fill.
       */
      const aFreshScaffold = async (dir: string): Promise<void> => {
        await aNextProject(dir);
        await writeScaffold(dir, {
          files: { [HOME_PAGE]: { hash: EDITED_HASH, class: "presentation" } },
          scaffolded_framework: true,
        });
      };

      it("restores the framework home page", async ({ dir }) => {
        await aFreshScaffold(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, HOME_PAGE)).toContain(MANAGED_MARKER);
      });

      it("leaves the check passing", async ({ dir }) => {
        await aFreshScaffold(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect((await new ManagedFilesCheck().run(aCheckContext(dir))).status).toBe("pass");
      });

      it("writes the route layouts a newer setup adds", async ({ dir }) => {
        await aFreshScaffold(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await textOf(dir, LOGIN_LAYOUT)).toContain(MANAGED_MARKER);
      });

      it("records the route layouts in the manifest", async ({ dir }) => {
        await aFreshScaffold(dir);

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, STATE_FILE)).toHaveProperty(["scaffold", "files", LOGIN_LAYOUT]);
      });

      it("reports a recorded route layout that goes missing", async ({ dir }) => {
        await aFreshScaffold(dir);
        await new ManagedFilesCheck().fix(aCheckContext(dir));
        await rm(join(dir, LOGIN_LAYOUT));

        const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

        expect(outcome.message).toContain(LOGIN_LAYOUT);
      });
    });
  });

  describe("on a Nuxt app from an older setup", () => {
    it.for(RETIRED_NUXT_PLUGINS)(
      "reports the retired %s once the user deleted it",
      async (retired, { dir }) => {
        await anOlderNuxtProject(dir);
        await rm(join(dir, retired));

        const outcome = await new ManagedFilesCheck().run(aCheckContext(dir));

        expect(outcome.message).toContain(retired);
      },
    );

    it.for(RETIRED_NUXT_PLUGINS)(
      "fix drops the retired %s record once the user deleted the file",
      async (retired, { dir }) => {
        await anOlderNuxtProject(dir);
        await rm(join(dir, retired));

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, STATE_FILE)).not.toHaveProperty(["scaffold", "files", retired]);
      },
    );

    it.for(RETIRED_NUXT_PLUGINS)(
      "fix leaves the check passing once the deleted %s is dropped",
      async (retired, { dir }) => {
        await anOlderNuxtProject(dir);
        await rm(join(dir, retired));

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect((await new ManagedFilesCheck().run(aCheckContext(dir))).status).toBe("pass");
      },
    );

    it.for(RETIRED_NUXT_PLUGINS)(
      "fix keeps the retired %s record while the file is on disk",
      async (retired, { dir }) => {
        await anOlderNuxtProject(dir);
        await rm(join(dir, "app/pages/login.vue"));

        await new ManagedFilesCheck().fix(aCheckContext(dir));

        expect(await readJson(dir, STATE_FILE)).toHaveProperty(["scaffold", "files", retired]);
      },
    );
  });
});

describe("ProjectMatchCheck", () => {
  it("passes when the secret's project_id matches the config's project", async ({ dir }) => {
    await aNextProject(dir);

    const outcome = await new ProjectMatchCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("pass");
  });

  it("fails when the secret's project_id disagrees with the config's project", async ({ dir }) => {
    await aNextProject(dir);
    await writeSecret(dir, { ...SECRET, project_id: "other" });

    const outcome = await new ProjectMatchCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("fail");
  });
});

describe("ClaimCheck", () => {
  it("warns that a cloud project with no owning team is temporary", async ({ dir }) => {
    await aNextProject(dir);

    const outcome = await new ClaimCheck().run(aCheckContext(dir));

    expect(outcome).toEqual(
      expect.objectContaining({
        status: "warn",
        message: expect.stringContaining("temporary and its data may be lost"),
        details: { claimable: true },
      }),
    );
  });

  it("passes and names the team once attached", async ({ dir }) => {
    await aNextProject(dir);
    await writeSecret(dir, {
      ...SECRET,
      claimed_at: "2026-01-02T00:00:00.000Z",
      team_id: "team-001",
    });

    const outcome = await new ClaimCheck().run(aCheckContext(dir));

    expect(outcome).toMatchObject({ status: "pass", message: expect.stringContaining("team-001") });
  });

  it.for(["http://localhost:8080", "https://zitadel.example.com"])(
    "passes without a nudge off the cloud, on %s",
    async (server, { dir }) => {
      await aNextProject(dir);
      await write(dir, {
        "zitadel.json": JSON.stringify({ project: PROJECT_ID, server, framework: { id: "next" } }),
      });

      const outcome = await new ClaimCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "pass",
        message: expect.not.stringContaining("temporary"),
      });
    },
  );

  it("skips, rather than throwing, when the secret cannot be read", async ({ dir }) => {
    await aNextProject(dir);
    await rm(join(dir, SECRET_FILE));

    const outcome = await new ClaimCheck().run(aCheckContext(dir));

    expect(outcome).toMatchObject({ status: "pass", message: expect.stringContaining("Skipped") });
  });

  describe("once the claim window has closed", () => {
    it.for([
      "claim window has closed",
      "npx @zitadel/cli@0.1.0-alpha.0 claim",
      "no longer be claimed",
    ])("warns, saying %s", async (said, { dir }) => {
      await aNextProject(dir);
      await writeSecret(dir, { ...SECRET, created_at: "2026-01-01T00:00:00.000Z" });

      const outcome = await new ClaimCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({ status: "warn", message: expect.stringContaining(said) });
    });

    it("reports the project as no longer claimable", async ({ dir }) => {
      await aNextProject(dir);
      await writeSecret(dir, { ...SECRET, created_at: "2026-01-01T00:00:00.000Z" });

      const outcome = await new ClaimCheck().run(aCheckContext(dir));

      expect(outcome.details).toEqual({ claimable: false });
    });
  });

  describe("fix", () => {
    it("leaves the secret as it is, claiming needing a browser", async ({ dir }) => {
      await aNextProject(dir);
      const before = await textOf(dir, SECRET_FILE);

      await new ClaimCheck().fix(aCheckContext(dir));

      expect(await textOf(dir, SECRET_FILE)).toBe(before);
    });

    it("leaves the check warning", async ({ dir }) => {
      await aNextProject(dir);

      await new ClaimCheck().fix(aCheckContext(dir));

      expect((await new ClaimCheck().run(aCheckContext(dir))).status).toBe("warn");
    });
  });
});

describe("loadPatchContext", () => {
  it("reconstructs the patch context from on-disk project files", async ({ dir }) => {
    await aNextProject(dir);

    const context = await loadPatchContext(dir, createOrca(), CHECK_CLI_VERSION);

    expect(context).toMatchObject({
      framework: { id: "next" },
      project: { id: PROJECT_ID },
      issuer: ISSUER,
      cliVersion: CHECK_CLI_VERSION,
      preset: undefined,
      scaffoldedFramework: undefined,
    });
  });

  it("restores the preset, the use case and the scaffold facts, the env file's issuer winning", async ({
    dir,
  }) => {
    await aNextProject(dir);
    await write(dir, {
      "zitadel.json": JSON.stringify({
        project: PROJECT_ID,
        server: CLOUD,
        framework: { id: "next" },
        preset: "passkey-first",
        useCase: "consumer",
      }),
    });
    await writeScaffold(dir, { files: {}, scaffolded_framework: true, dev_port: 3005 });

    const context = await loadPatchContext(dir, createOrca(), CHECK_CLI_VERSION);

    expect(context).toMatchObject({
      preset: "passkey-first",
      useCase: "consumer",
      scaffoldedFramework: true,
      issuer: ISSUER,
    });
  });

  it("takes the issuer from the project's files, never the shell's environment", async ({
    dir,
  }) => {
    await aNextProject(dir);
    vi.stubEnv("ZITADEL_ENV", "production");
    vi.stubEnv("ZITADEL_ISSUER", "https://auth.example.com");

    const context = await loadPatchContext(dir, createOrca(), CHECK_CLI_VERSION);

    expect(context.issuer).toBe(ISSUER);
  });

  it("falls back to the manifest's dev_port for the issuer", async ({ dir }) => {
    await aNextProject(dir);
    await rm(join(dir, ".env.local"));
    await writeScaffold(dir, { files: {}, dev_port: 3005 });

    const context = await loadPatchContext(dir, createOrca(), CHECK_CLI_VERSION);

    expect(context.issuer).toBe("http://localhost:3005");
  });

  it.for([
    ["the recorded posture", { files: {}, posture: "widget" }, "widget"],
    ["page for a manifest that records none", { files: {} }, "page"],
    [
      "page for a manifest with an unknown posture, which it rejects whole",
      { files: {}, posture: "split" },
      "page",
    ],
  ] as const)("restores %s", async ([, scaffold, posture], { dir }) => {
    await aNextProject(dir);
    await writeScaffold(dir, scaffold);

    const context = await loadPatchContext(dir, createOrca(), CHECK_CLI_VERSION);

    expect(context.posture).toBe(posture);
  });
});

describe("DependencyVersionCheck", () => {
  it("passes when the exact Zitadel pins match the CLI version", async ({ dir }) => {
    await aNextProject(dir);
    await write(dir, {
      "package.json": JSON.stringify({
        name: "demo",
        dependencies: { next: "^15", "@zitadel/sdk-next": RELEASE },
      }),
    });

    const outcome = await new DependencyVersionCheck().run(
      aCheckContext(dir, { cliVersion: RELEASE }),
    );

    expect(outcome).toMatchObject({
      status: "pass",
      message: expect.stringContaining("1 compared"),
    });
  });

  it("ignores ranges, dist-tags and file specifiers", async ({ dir }) => {
    await aNextProject(dir);
    await write(dir, {
      "package.json": JSON.stringify({
        name: "demo",
        dependencies: {
          "@zitadel/sdk-next": "latest",
          "@zitadel/components": "^0.1.0-alpha.2",
          "@zitadel/api": "file:../local.tgz",
        },
      }),
    });

    const outcome = await new DependencyVersionCheck().run(
      aCheckContext(dir, { cliVersion: RELEASE }),
    );

    expect(outcome).toMatchObject({
      status: "pass",
      message: expect.stringContaining("No exactly-pinned"),
    });
  });

  it("skips the comparison for a CLI version that is no release", async ({ dir }) => {
    await aNextProject(dir);

    const outcome = await new DependencyVersionCheck().run(
      aCheckContext(dir, { cliVersion: "workspace-dev" }),
    );

    expect(outcome).toMatchObject({
      status: "pass",
      message: expect.stringContaining("not an exact release"),
    });
  });

  it.for([
    [
      "is missing, which the dependency check reports",
      (dir: string) => {
        return rm(join(dir, "package.json"));
      },
    ],
    [
      "is not valid JSON",
      (dir: string) => {
        return write(dir, { "package.json": "{ not json" });
      },
    ],
  ] as const)("passes quietly when package.json %s", async ([, spoil], { dir }) => {
    await aNextProject(dir);
    await spoil(dir);

    const outcome = await new DependencyVersionCheck().run(
      aCheckContext(dir, { cliVersion: RELEASE }),
    );

    expect(outcome.status).toBe("pass");
  });

  describe("with pins trailing the CLI's release", () => {
    /**
     * Fills `dir` with a project pinning the SDK and the test kit one release
     * behind {@link RELEASE}, with no lockfile, so npm is the package manager.
     *
     * @param dir - The directory to fill.
     */
    const aTrailingProject = async (dir: string): Promise<void> => {
      await aNextProject(dir);
      await write(dir, {
        "package.json": JSON.stringify({
          name: "demo",
          dependencies: { "@zitadel/sdk-next": TRAILING },
          devDependencies: { "@zitadel/testing": TRAILING },
        }),
      });
    };

    it("warns, naming a trailing pin", async ({ dir }) => {
      await aTrailingProject(dir);

      const outcome = await new DependencyVersionCheck().run(
        aCheckContext(dir, { cliVersion: RELEASE }),
      );

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringContaining(`@zitadel/sdk-next@${TRAILING}`),
      });
    });

    it("names every trailing pin", async ({ dir }) => {
      await aTrailingProject(dir);

      const outcome = await new DependencyVersionCheck().run(
        aCheckContext(dir, { cliVersion: RELEASE }),
      );

      expect(outcome.details).toEqual({
        mismatched: [
          { name: "@zitadel/sdk-next", declared: TRAILING, expected: RELEASE },
          { name: "@zitadel/testing", declared: TRAILING, expected: RELEASE },
        ],
      });
    });

    it("gives the exact npm remedy for every trailing pin", async ({ dir }) => {
      await aTrailingProject(dir);

      const outcome = await new DependencyVersionCheck().run(
        aCheckContext(dir, { cliVersion: RELEASE }),
      );

      expect(outcome.remedy).toBe(
        `npm install --save-exact @zitadel/sdk-next@${RELEASE} @zitadel/testing@${RELEASE}`,
      );
    });

    it("writes the remedy with the project's own package manager", async ({ dir }) => {
      await aNextProject(dir);
      await write(dir, {
        "package.json": JSON.stringify({
          name: "demo",
          dependencies: { "@zitadel/sdk-next": TRAILING },
        }),
        "pnpm-lock.yaml": "",
      });

      const outcome = await new DependencyVersionCheck().run(
        aCheckContext(dir, { cliVersion: RELEASE }),
      );

      expect(outcome).toMatchObject({
        status: "warn",
        remedy: `pnpm add --save-exact @zitadel/sdk-next@${RELEASE}`,
      });
    });
  });
});
