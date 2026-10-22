import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { $fetch, fetch, setup } from "@nuxt/test-utils/e2e";
import { publint } from "publint";
import { formatMessage } from "publint/utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildModule,
  copyFixture,
  installModule,
  MODULE_NAME,
  PACKAGE_ROOT,
  packModule,
  prepareApp,
  run,
  typeErrors,
  workDirectory,
} from "./harness.ts";

const work = workDirectory();
const moduleDir = join(work, "module");
const appDir = join(work, "app");
const typesDir = join(work, "app-types");
const tarballDir = join(work, "tarball");
let tarball = "";

/** The built module, as the app installed it. */
const installed = (...path: string[]) => join(appDir, "node_modules", MODULE_NAME, ...path);

// The module is built, packed and installed before Nuxt builds the app, and removed after it stops.
beforeAll(async () => {
  rmSync(work, { recursive: true, force: true });
  copyFixture("module", moduleDir);
  await buildModule(moduleDir);
  tarball = await packModule(moduleDir, tarballDir);
  copyFixture("app", appDir);
  await installModule(tarball, appDir);
}, 600_000);
afterAll(() => {
  if (!process.env.KEEP_CONTRACT_WORKDIR) rmSync(work, { recursive: true, force: true });
});

await setup({ rootDir: appDir, build: true, server: true, browser: false });

describe("the built package", () => {
  it("is a publishable package", async () => {
    const { messages } = await publint({ pkgDir: installed(), strict: true });
    expect(messages.map((message) => formatMessage(message, { pkg: {} as never }))).toEqual([]);
  });

  it("resolves for ESM consumers under every resolution mode they use", async () => {
    // attw exits non-zero on any problem it does not ignore for ESM-only packages.
    const output = await run(
      join(PACKAGE_ROOT, "node_modules/.bin/attw"),
      [tarball, "--profile", "esm-only", "--format", "ascii"],
      { cwd: work },
    );
    expect(output).toContain('"hello-timing/server"');
  }, 120_000);

  it("describes itself in module.json", () => {
    expect(JSON.parse(readFileSync(installed("dist/module.json"), "utf8"))).toMatchObject({
      name: "hello-timing",
      configKey: "helloTiming",
      version: "1.2.3",
      compatibility: { nuxt: ">=4" },
    });
  });

  it("ships the runtime file by file, as Nuxt compiles it", () => {
    const vue = readFileSync(installed("dist/runtime/components/HelloBanner.vue"), "utf8");
    expect([
      vue.includes('lang="ts"'),
      vue.includes('lang="scss"'),
      vue.includes("#123456"),
      existsSync(installed("dist/runtime/components/HelloBanner.vue.d.ts")),
      existsSync(installed("dist/runtime/assets/_vars.css")),
      readFileSync(installed("dist/runtime/assets/hello.css"), "utf8").includes("#654321"),
    ]).toEqual([false, false, true, true, false, true]);
  });
});

describe("the module in a Nuxt app", () => {
  it("renders its components, composables, plugins and config into the page", async () => {
    const html = await $fetch<string>("/");
    expect(html).toContain('<p class="hello-banner" data-test="banner"');
    expect(html).toContain("Hello, banner!");
    expect(html).toContain('data-test="extra">extra component');
    expect(html).toContain('data-test="composable">Hello, home!');
    expect(html).toContain('data-test="auto-import">hello:contract:vite-plugin');
    expect(html).toContain('data-test="plugin">Hello, plugin!');
    expect(html).toContain('data-test="plugin-template">Hello');
    expect(html).toContain('data-test="app-config">Hello Timing');
    expect(html).toContain("<title>Hello Timing</title>");
    expect(html).toMatch(/data-test="nuxt">4\.\d+\.\d+\|true\|1</);
    // The module's own hook, the app's and the module's setup all add to the one list.
    const greetings = /data-test="greetings">([^<]*)</.exec(html)?.[1]?.split("|");
    expect(greetings?.sort()).toEqual([
      "Hello, setup!",
      "from the app hook",
      "from the module hook",
    ]);
  });

  it("keeps the private runtime config on the server", async () => {
    const html = await $fetch<string>("/");
    expect(html).not.toContain("s3cr3t-value");
    expect(await $fetch("/api/hello-timing/hello")).toMatchObject({ secretConfigured: true });
  });

  it("links the stylesheets the plugin compiled from Sass", async () => {
    const html = await $fetch<string>("/");
    const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    const linked = (await Promise.all(hrefs.map((href) => $fetch<string>(href ?? "")))).join("\n");
    // The global stylesheet is a file of the module; the component's scoped style is inlined into the page.
    expect(linked).toContain(".hello-global{border-top:1px solid #654321}");
    expect(html).toContain("{color:#123456}");
  });

  it("serves the page and the layout the module adds, with the route rule it sets", async () => {
    const response = await fetch("/hello");
    const html = await response.text();
    expect(html).toContain('data-test="hello-layout"');
    expect(html).toContain('data-test="hello-page">Hello, hello page!');
    expect(response.headers.get("x-hello-rule")).toBe("1");
  });

  it("redirects the secret path to /hello in the route middleware", async () => {
    const response = await fetch("/secret", { redirect: "manual" });
    expect([response.status, response.headers.get("location")]).toEqual([302, "/hello"]);
  });

  it("serves the module's API route", async () => {
    expect(await $fetch("/api/hello-timing/hello", { query: { name: "world" } })).toEqual({
      message: "Hello, world!",
      secretConfigured: true,
      build: true,
    });
  });

  it("times every response in server middleware and marks it in a Nitro plugin", async () => {
    for (const path of ["/", "/api/hello-timing/hello", "/hello"]) {
      const response = await fetch(path);
      expect([path, response.headers.get("server-timing")]).toEqual([
        path,
        expect.stringMatching(/^hello;dur=\d+\.\d$/),
      ]);
      expect(response.headers.get("x-hello-plugin")).toBe("1");
    }
  });

  it("scans the server directory the module adds", async () => {
    expect(await $fetch("/api/scanned")).toEqual({ scanned: true });
  });

  it("auto-imports the module's server utilities and aliases them for Nitro", async () => {
    expect(await $fetch("/api/auto")).toEqual({
      greeting: "Hello, auto!",
      aliased: "Hello, alias!",
      uptime: true,
    });
  });
});

describe("the module's types in an app", () => {
  it("type-check a consumer against the generated types, and reject what they forbid", async () => {
    copyFixture("app", typesDir);
    await installModule(tarball, typesDir);
    await prepareApp(typesDir);
    expect(typeErrors(typesDir, "app/consumer.ts")).toEqual([]);
  }, 300_000);
});
