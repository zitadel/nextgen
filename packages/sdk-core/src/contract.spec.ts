// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ZitadelLogin, ZitadelLogout, ZitadelSession } from "@zitadel/components";
import { DISPATCHED_EVENTS } from "@zitadel/components/events";
import { describe, expect, it } from "vitest";

import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGIN_EVENTS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENTS,
  ZITADEL_SESSION_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENTS,
  type ZitadelLoginConfig,
  type ZitadelLogoutConfig,
  type ZitadelSessionConfig,
} from "./types.js";

/**
 * The element↔contract drift guard.
 *
 * `@zitadel/components` publishes the widget events its elements dispatch
 * ({@link DISPATCHED_EVENTS}, checked against its own source by its
 * `events.spec.ts`). This asserts that set is EXACTLY the SPA contract
 * ({@link ZITADEL_LOGIN_EVENTS} + {@link ZITADEL_LOGOUT_EVENTS} +
 * {@link ZITADEL_SESSION_EVENTS}, deduped — `zitadel-signout` is shared by the
 * logout menu and the session card). Adding or removing a widget event in the
 * elements therefore fails here until the contract is updated — and updating
 * the contract forces every SDK (via their contract-driven forwarding tests) to
 * wire or drop the event.
 */
describe("SPA widget contract ↔ @zitadel/components", () => {
  it("declares exactly the events the elements dispatch", () => {
    const declared = [
      ...new Set([...ZITADEL_LOGIN_EVENTS, ...ZITADEL_LOGOUT_EVENTS, ...ZITADEL_SESSION_EVENTS]),
    ].sort();
    expect([...DISPATCHED_EVENTS].sort()).toEqual(declared);
  });

  it("maps every event to a distinct handler prop", () => {
    for (const handlers of [
      ZITADEL_LOGIN_EVENT_HANDLERS,
      ZITADEL_LOGOUT_EVENT_HANDLERS,
      ZITADEL_SESSION_EVENT_HANDLERS,
    ]) {
      const names = Object.values(handlers);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});

/**
 * The element↔config drift guard for properties.
 *
 * The SPA SDK wrappers take their props from the config types in `types.ts`,
 * while the elements' real public properties are the Lit reactive properties
 * in `@zitadel/components`. Nothing tied the two together, so a property added
 * to an element (`resumeFlowId`) was silently missing from every wrapper. This
 * lives here, not in `@zitadel/components`, because the dependency points this
 * way: `sdk-core` already depends on the components (for the event guard
 * above) and the components never import `sdk-core`.
 *
 * Each `*_CONFIG_KEYS` object is checked against its config type by `satisfies
 * Record<keyof Config, …>`, so a key added to or removed from a config type
 * fails `tsc` until the list is updated, and the runtime tests then compare
 * the list with the element's `elementProperties`. A public element property
 * that is not a config key must be listed in `*_ELEMENT_ONLY` with a reason.
 */
const LOGIN_CONFIG_KEYS = {
  project: true,
  projectId: true,
  proxyPath: true,
  variant: true,
  theme: true,
  suppressHeader: true,
  suppressPasswordToggle: true,
  purpose: true,
  flowName: true,
  postSignInUrl: true,
  resumeFlowId: true,
  locales: true,
  lang: true,
} satisfies Record<keyof ZitadelLoginConfig, true>;

const SESSION_CONFIG_KEYS = {
  project: true,
  projectId: true,
  proxyPath: true,
  postSignOutUrl: true,
  heading: true,
  logoutLabel: true,
  variant: true,
  theme: true,
  suppressHeader: true,
} satisfies Record<keyof ZitadelSessionConfig, true>;

const LOGOUT_CONFIG_KEYS = {
  project: true,
  projectId: true,
  proxyPath: true,
  postSignOutUrl: true,
  theme: true,
} satisfies Record<keyof ZitadelLogoutConfig, true>;

const URL_REASON =
  "declarative full backend URL for plain HTML pages; SPA wrappers configure the backend through project or proxyPath";

const HANDLE_REASONS: Record<string, string> = {
  publishableKey:
    "declarative form of the project handle's publishableKey, which SPA wrappers pass inside project",
};

const LOGIN_ELEMENT_ONLY: Record<string, string> = {
  url: URL_REASON,
  ...HANDLE_REASONS,
  previewState: "operator preview mode, not part of the shared login config",
  previewSuccessStep: "operator preview mode, not part of the shared login config",
};

const SESSION_ELEMENT_ONLY: Record<string, string> = { url: URL_REASON, ...HANDLE_REASONS };

const LOGOUT_ELEMENT_ONLY: Record<string, string> = { url: URL_REASON, ...HANDLE_REASONS };

type Declaration = { state?: boolean };
type ElementCtor = (typeof ZitadelLogin | typeof ZitadelSession | typeof ZitadelLogout) & {
  elementProperties: Map<PropertyKey, Declaration>;
};

/** Public reactive property names of an element (`@state` ones are internal). */
function publicProperties(ctor: ElementCtor, tag: string): string[] {
  // Force Lit finalization so `elementProperties` is fully populated.
  document.createElement(tag);
  const names: string[] = [];
  for (const [prop, decl] of ctor.elementProperties) {
    if (!decl.state) names.push(String(prop));
  }
  return names;
}

describe("config types ↔ element properties", () => {
  describe.each([
    ["zitadel-login", ZitadelLogin, LOGIN_CONFIG_KEYS, LOGIN_ELEMENT_ONLY],
    ["zitadel-session", ZitadelSession, SESSION_CONFIG_KEYS, SESSION_ELEMENT_ONLY],
    ["zitadel-logout", ZitadelLogout, LOGOUT_CONFIG_KEYS, LOGOUT_ELEMENT_ONLY],
  ] as const)("<%s>", (tag, ctor, configKeys, elementOnly) => {
    const properties = publicProperties(ctor as ElementCtor, tag);

    it("has public properties to compare", () => {
      expect(properties.length).toBeGreaterThan(0);
    });

    it("represents every public property as a config key or a justified exclusion", () => {
      const unaccounted = properties.filter(
        (name) => !(name in configKeys) && !(name in elementOnly),
      );
      expect(unaccounted).toEqual([]);
    });

    it("backs every config key with an element property", () => {
      const missing = Object.keys(configKeys).filter((key) => !properties.includes(key));
      expect(missing).toEqual([]);
    });

    it("lists only real element properties that are not config keys as exclusions", () => {
      const stale = Object.keys(elementOnly).filter(
        (name) => !properties.includes(name) || name in configKeys,
      );
      expect(stale).toEqual([]);
    });

    it("gives every exclusion a reason", () => {
      for (const [name, reason] of Object.entries(elementOnly)) {
        expect(reason.trim(), `reason for ${name}`).not.toBe("");
      }
    });
  });
});

/**
 * The SDK specs that write widget attributes into markup each carry the same
 * server-render table between two marker comments, so every SDK is held to the
 * same cases. Only the SDK's own `renderAttributes` differs. This fails when
 * the copies drift apart.
 */
describe("server-render cases ↔ SDK specs", () => {
  const SPECS = [
    "../../sdk-react/src/index.spec.tsx",
    "../../sdk-vue/src/components.spec.ts",
    "../../sdk-angular/src/lib/components.spec.ts",
    "../../sdk-svelte/src/index.spec.ts",
  ];

  const casesIn = (spec: string): string => {
    const source = readFileSync(fileURLToPath(new URL(spec, import.meta.url)), "utf8");
    const begin = source.indexOf("// server-render-cases:begin");
    const end = source.indexOf("// server-render-cases:end");
    expect(begin, `${spec} has no server-render cases`).toBeGreaterThanOrEqual(0);
    expect(end, `${spec} has an unterminated server-render cases block`).toBeGreaterThan(begin);
    return source.slice(begin, end);
  };

  it.each(SPECS)("%s carries the same cases as the React spec", (spec) => {
    expect(casesIn(spec)).toBe(casesIn(SPECS[0]!));
  });
});

/**
 * Apps go through their SDK. Each SDK that renders the widgets lists
 * `@zitadel/components` as its own dependency, so the elements load from the SDK
 * and the app never installs or imports `components` by name; no SDK's docs tell
 * a user to add it.
 */
describe("widget loading ↔ SDK packages", () => {
  // Vitest runs with the package directory as cwd; `import.meta.url` is rewritten under jsdom.
  const packagesDir = `${resolve(process.cwd(), "..")}/`;
  const sdkDirs = readdirSync(packagesDir).filter((dir) => dir.startsWith("sdk-"));
  const WIDGET_SDKS = [
    "sdk-angular",
    "sdk-next",
    "sdk-nuxt",
    "sdk-qwik",
    "sdk-react",
    "sdk-solid",
    "sdk-svelte",
    "sdk-vue",
  ];

  const read = (path: string): string => readFileSync(path, "utf8");

  it.each(WIDGET_SDKS)("%s depends on @zitadel/components itself", (dir) => {
    const manifest = JSON.parse(read(`${packagesDir}${dir}/package.json`)) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies?.["@zitadel/components"]).toBeDefined();
    expect(manifest.peerDependencies?.["@zitadel/components"]).toBeUndefined();
  });

  // Apps go through their framework's SDK, which owns these packages as its own
  // dependencies, so no demo declares or imports them.
  const SDK_OWNED = ["@zitadel/components", "@zitadel/api", "@zitadel/design-tokens"];
  const appsDir = `${resolve(process.cwd(), "../..")}/apps/`;
  const demoDirs = readdirSync(appsDir).filter((dir) => dir.startsWith("demo-"));
  const SKIPPED_DIRS = /^(node_modules|dist|\.output|\.next.*|\.nuxt.*)$/;
  const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;
  const SDK_OWNED_IMPORT =
    /(?:from|import|require)\s*\(?\s*["'](@zitadel\/(?:components|api|design-tokens))(?:\/[^"']*)?["']/;

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isDirectory()) {
        return SKIPPED_DIRS.test(entry.name) ? [] : sourceFiles(`${dir}/${entry.name}`);
      }
      return SOURCE_FILE.test(entry.name) ? [`${dir}/${entry.name}`] : [];
    });

  // The checks above read files outside this package, so both runners must list
  // them as test inputs; otherwise a change there neither reruns the test nor
  // invalidates its cached result.
  it.each(["moon.yml", "turbo.json"])(
    "%s lists the files the checks read as test inputs",
    (file) => {
      const config = read(`${packagesDir}sdk-core/${file}`);
      for (const input of [
        "packages/sdk-*/package.json",
        "packages/sdk-*/README.md",
        "packages/sdk-*/skills/**/SKILL.md",
        "apps/demo-*/package.json",
        "apps/demo-*/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,vue,svelte,astro}",
      ]) {
        expect(config, `${file} has no test input ${input}`).toContain(input);
      }
    },
  );

  it("finds the in-repo demo apps", () => {
    expect(demoDirs.length).toBeGreaterThan(0);
  });

  it.each(demoDirs)("%s does not declare the SDK-owned packages as dependencies", (dir) => {
    const manifest = JSON.parse(read(`${appsDir}${dir}/package.json`)) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(declared.filter((name) => SDK_OWNED.includes(name))).toEqual([]);
  });

  it.each(demoDirs)("%s never imports the SDK-owned packages", (dir) => {
    const offenders = sourceFiles(`${appsDir}${dir}`).flatMap((path) => {
      const match = read(path).match(SDK_OWNED_IMPORT);
      return match ? [`${path.slice(appsDir.length)} imports ${match[1]}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it.each(sdkDirs)("%s docs never tell an app to install @zitadel/components", (dir) => {
    const skillsDir = `${packagesDir}${dir}/skills`;
    const docs = [
      `${packagesDir}${dir}/README.md`,
      ...(existsSync(skillsDir)
        ? readdirSync(skillsDir).map((skill) => `${skillsDir}/${skill}/SKILL.md`)
        : []),
    ].filter((path) => existsSync(path));
    for (const path of docs) {
      expect(read(path)).not.toMatch(
        /(?:pnpm|npm|yarn|bun)\s+(?:add|install|i)\b[^\n]*@zitadel\/components/,
      );
    }
  });
});

/**
 * The server SDKs' test titles.
 *
 * The four meta-framework SDKs test the same server behaviours, so their test
 * files carry the same titles. A behaviour tested under another title, or left
 * untested in one SDK, then shows up here instead of drifting unnoticed.
 */
describe("server SDK test titles", () => {
  const packagesPath = `${resolve(process.cwd(), "..")}/`;
  const TEST_FILES = {
    "sdk-sveltekit": "sdk-sveltekit/src/__tests__/handle.test.ts",
    "sdk-solid-start": "sdk-solid-start/src/__tests__/middleware.test.ts",
    "sdk-qwik-city": "sdk-qwik-city/src/__tests__/request-handler.test.ts",
    "sdk-tanstack-start": "sdk-tanstack-start/src/__tests__/middleware.test.ts",
  } as const;

  const CANONICAL_TITLES = [
    "public route with no token continues as unauthenticated",
    "protected route with no token redirects to /login?next=/admin",
    "protected route with a valid cookie token authenticates",
    "protected route with a valid Bearer token authenticates",
    "Bearer token takes precedence over the session cookie",
    "token with no sub claim is treated as unauthenticated",
    "token with a disallowed typ is rejected",
    "token with a disallowed algorithm is rejected",
    'token with alg "none" is rejected without fetching JWKS',
    "RS256 tokens are accepted by default",
    "redirect preserves existing query params in loginPath",
    "invalid token clears the stale session cookie and redirects",
    "absolute loginPath throws",
    "protocol-relative loginPath throws",
    "strips x-nextgen-auth-token from proxied requests",
    "forwards upstream Set-Cookie headers",
    "appends the client IP to an existing X-Forwarded-For chain",
    "sets X-Forwarded-For from the client IP when no chain exists",
    "omits X-Forwarded-For when no client IP is available",
    "skips auth handling on an ignored route",
    "refuses the request when the header cannot be removed",
    "lets the request through when removal fails but the header is absent",
  ];

  // SvelteKit and SolidStart swallow a failed removal of the inbound header
  // instead of refusing the request, so neither has these two cases to test.
  const EXCEPTIONS: Record<keyof typeof TEST_FILES, readonly string[]> = {
    "sdk-sveltekit": [
      "refuses the request when the header cannot be removed",
      "lets the request through when removal fails but the header is absent",
    ],
    "sdk-solid-start": [
      "refuses the request when the header cannot be removed",
      "lets the request through when removal fails but the header is absent",
    ],
    "sdk-qwik-city": [],
    "sdk-tanstack-start": [],
  };

  // Matches `it("title"` and the `it.each([...])("title"` form.
  const TITLE = /(?:\bit\(|\]\)\()\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

  const titlesOf = (sdk: keyof typeof TEST_FILES): string[] =>
    [...readFileSync(`${packagesPath}${TEST_FILES[sdk]}`, "utf8").matchAll(TITLE)].map(
      (match) => match[2]!,
    );

  it.each(Object.keys(TEST_FILES) as (keyof typeof TEST_FILES)[])(
    "%s tests every canonical behaviour under its canonical title",
    (sdk) => {
      const titles = titlesOf(sdk);
      const expected = CANONICAL_TITLES.filter((title) => !EXCEPTIONS[sdk].includes(title));
      expect(expected.filter((title) => !titles.includes(title))).toEqual([]);
    },
  );

  it.each(Object.keys(TEST_FILES) as (keyof typeof TEST_FILES)[])(
    "%s lists the canonical titles in the canonical order",
    (sdk) => {
      const titles = titlesOf(sdk);
      const listed = CANONICAL_TITLES.filter((title) => titles.includes(title));
      const inFile = titles.filter((title) => CANONICAL_TITLES.includes(title));
      expect(inFile).toEqual(listed);
    },
  );
});
