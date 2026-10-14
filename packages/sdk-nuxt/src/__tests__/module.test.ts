import type { Nuxt } from "@nuxt/schema";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import nextgenModule from "../module";

// These register the plugin, server handler and composables on a running
// Nuxt; the tests only read the runtime config the module computes.
vi.mock("@nuxt/kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nuxt/kit")>()),
  addPlugin: vi.fn(),
  addServerHandler: vi.fn(),
  addImportsDir: vi.fn(),
}));

interface ModuleRuntimeConfig {
  nextgen: Record<string, unknown>;
  public: Record<string, unknown>;
}

let rootDir: string;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "sdk-nuxt-module-"));
  for (const name of ["ZITADEL_URL", "ZITADEL_PROJECT_SECRET", "NUXT_PUBLIC_ZITADEL_PROJECT_ID"]) {
    vi.stubEnv(name, undefined);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(rootDir, { recursive: true, force: true });
});

/** Installs the module into a minimal Nuxt and returns the runtime config it wrote. */
async function install(
  app: {
    nextgen?: Record<string, unknown>;
    publicRuntimeConfig?: Record<string, unknown>;
    envLocal?: string;
    vue?: { compilerOptions?: { isCustomElement?: (tag: string) => boolean } };
  } = {},
): Promise<ModuleRuntimeConfig> {
  return (await installNuxt(app)).runtimeConfig;
}

/** Installs the module and returns the Nuxt options it changed. */
async function installNuxt(app: Parameters<typeof install>[0] = {}): Promise<{
  runtimeConfig: ModuleRuntimeConfig;
  vue: { compilerOptions: { isCustomElement: (tag: string) => boolean } };
}> {
  if (app.envLocal !== undefined) {
    writeFileSync(join(rootDir, ".env.local"), app.envLocal);
  }
  const runtimeConfig = { public: { ...app.publicRuntimeConfig } };
  const nuxt = { options: { rootDir, nextgen: app.nextgen ?? {}, runtimeConfig, vue: app.vue } };
  await nextgenModule({}, nuxt as unknown as Nuxt);
  return nuxt.options as unknown as Awaited<ReturnType<typeof installNuxt>>;
}

describe("@zitadel/sdk-nuxt module", () => {
  it.each(["zitadel-login", "zitadel-logout", "zitadel-session"])(
    "tells Vue that <%s> is a custom element",
    async (tag) => {
      const { vue } = await installNuxt();

      expect(vue.compilerOptions.isCustomElement(tag)).toBe(true);
    },
  );

  it("leaves other tags to Vue's component resolution", async () => {
    const { vue } = await installNuxt();

    expect(vue.compilerOptions.isCustomElement("my-widget")).toBe(false);
  });

  it("keeps the app's own isCustomElement predicate", async () => {
    const { vue } = await installNuxt({
      vue: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("ion-") } },
    });

    expect(vue.compilerOptions.isCustomElement("ion-button")).toBe(true);
    expect(vue.compilerOptions.isCustomElement("zitadel-login")).toBe(true);
  });

  it("hands a custom proxyPath to the server middleware and to the widgets", async () => {
    const runtime = await install({ nextgen: { proxyPath: "/auth" } });

    expect(runtime.nextgen.proxyPath).toBe("/auth");
    expect(runtime.public.zitadelProxyPath).toBe("/auth");
    expect(runtime.public.nextgenProxyPath).toBe("/auth");
  });

  it("hands every middleware option to the server middleware", async () => {
    const options = {
      ignoredRoutes: ["/health"],
      allowedAlgorithms: ["ES256"],
      allowedTokenTypes: [],
      audience: "api",
      clockSkewMs: 1000,
      jwksTimeoutMs: 2000,
      proxyTimeoutMs: 3000,
      opaqueTokenTimeoutMs: 4000,
    };

    const runtime = await install({ nextgen: options });

    expect(runtime.nextgen).toMatchObject(options);
  });

  it("declares the options it was not given, so NUXT_NEXTGEN_* can set them at runtime", async () => {
    const runtime = await install();

    // Nitro only applies an environment override to a key that exists.
    expect(runtime.nextgen).toHaveProperty("audience", undefined);
    expect(runtime.nextgen).toHaveProperty("ignoredRoutes", undefined);
    expect(runtime.nextgen).toHaveProperty("proxyTimeoutMs", undefined);
  });

  it("defaults to the local server and the /__nextgen prefix", async () => {
    const runtime = await install();

    expect(runtime.nextgen.url).toBe("http://localhost:8080");
    expect(runtime.nextgen.proxyPath).toBe("/__nextgen");
    expect(runtime.nextgen.projectSecret).toBeUndefined();
    expect(runtime.public.zitadelProjectId).toBe("");
  });

  it("reads the URL, the project id and the secret from .env.local", async () => {
    const runtime = await install({
      envLocal: [
        "ZITADEL_URL=https://zitadel.example",
        "NUXT_PUBLIC_ZITADEL_PROJECT_ID=proj_local",
        "ZITADEL_PROJECT_SECRET=sk_local",
      ].join("\n"),
    });

    expect(runtime.nextgen.url).toBe("https://zitadel.example");
    expect(runtime.public.zitadelProjectId).toBe("proj_local");
    expect(runtime.nextgen.projectSecret).toBe("sk_local");
  });

  it("prefers the environment over .env.local", async () => {
    vi.stubEnv("ZITADEL_URL", "https://env.example");
    vi.stubEnv("NUXT_PUBLIC_ZITADEL_PROJECT_ID", "proj_env");
    vi.stubEnv("ZITADEL_PROJECT_SECRET", "sk_env");

    const runtime = await install({
      envLocal: [
        "ZITADEL_URL=https://zitadel.example",
        "NUXT_PUBLIC_ZITADEL_PROJECT_ID=proj_local",
        "ZITADEL_PROJECT_SECRET=sk_local",
      ].join("\n"),
    });

    expect(runtime.nextgen.url).toBe("https://env.example");
    expect(runtime.public.zitadelProjectId).toBe("proj_env");
    expect(runtime.nextgen.projectSecret).toBe("sk_env");
  });

  it("keeps a URL and a project id set in nuxt.config", async () => {
    vi.stubEnv("ZITADEL_URL", "https://env.example");

    const runtime = await install({
      nextgen: { url: "https://config.example" },
      publicRuntimeConfig: { zitadelProjectId: "proj_config" },
      envLocal: "NUXT_PUBLIC_ZITADEL_PROJECT_ID=proj_local\n",
    });

    expect(runtime.nextgen.url).toBe("https://config.example");
    expect(runtime.public.zitadelProjectId).toBe("proj_config");
  });

  it("parses .env.local like dotenv", async () => {
    const runtime = await install({
      envLocal: [
        "# written by zitadel setup",
        "ZITADEL_URL=",
        "export NUXT_PUBLIC_ZITADEL_PROJECT_ID='proj #1' # quoted",
        "ZITADEL_PROJECT_SECRET=sk_#1 # comment",
      ].join("\r\n"),
    });

    // An empty value counts as unset.
    expect(runtime.nextgen.url).toBe("http://localhost:8080");
    expect(runtime.public.zitadelProjectId).toBe("proj #1");
    expect(runtime.nextgen.projectSecret).toBe("sk_#1");
  });
});

// The module auto-imports `runtime/composables` from the published dist, so a
// composable the build leaves out is an undefined global in every app page
// (`useZitadelProject is not defined`). `sdk-nuxt:test` runs after the build.
describe("auto-imported composables", () => {
  const source = join(import.meta.dirname, "../runtime/composables");
  const built = join(import.meta.dirname, "../../dist/runtime/composables");

  it.each(readdirSync(source).filter((file) => file.endsWith(".ts")))(
    "ships %s in the built composables directory",
    (file) => {
      expect(existsSync(join(built, file.replace(/\.ts$/, ".js")))).toBe(true);
    },
  );
});
