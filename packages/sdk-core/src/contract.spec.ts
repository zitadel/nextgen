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
  forcePostSignInUrl: true,
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
 * The standard-attribute tests.
 *
 * Every client SDK's wrapper forwards the element's standard HTML attributes to
 * the widget element, and every SDK spec proves it with the same tests between
 * two marker comments: the same titles, in the same order, with none missing and
 * none extra, and the same bodies. Only the SDK's own `mountWidget` differs. A
 * behaviour left untested in one SDK, or tested under another title, fails here
 * instead of drifting unnoticed.
 */
describe("standard-attribute tests ↔ SDK specs", () => {
  const SPECS = {
    "sdk-react": "../../sdk-react/src/index.spec.tsx",
    "sdk-vue": "../../sdk-vue/src/components.spec.ts",
    "sdk-angular": "../../sdk-angular/src/lib/components.spec.ts",
    "sdk-svelte": "../../sdk-svelte/src/index.spec.ts",
    "sdk-solid": "../../sdk-solid/src/index.spec.tsx",
    "sdk-qwik": "../../sdk-qwik/src/index.spec.tsx",
  } as const;

  const CANONICAL_TITLES = [
    "%s standard attributes",
    "forwards the class to the widget element",
    "forwards the style to the widget element",
    "forwards the id to the widget element",
    "forwards data attributes to the widget element",
    "forwards aria attributes to the widget element",
    "forwards the remaining standard attributes to the widget element",
    "forwards the slot to the widget element",
    "lets a widget prop win over a standard attribute of the same name",
    "gives access to the widget element through a ref",
  ];

  // Matches `it("title"` and the `describe.each(WIDGETS)("title"` form.
  const TITLE = /(?:\bit\(|\bdescribe\.each\(\w+\)\()\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

  const blockOf = (spec: string): string => {
    const source = readFileSync(fileURLToPath(new URL(spec, import.meta.url)), "utf8");
    const begin = source.indexOf("// standard-attributes:begin");
    const end = source.indexOf("// standard-attributes:end");
    expect(begin, `${spec} has no standard-attribute tests`).toBeGreaterThanOrEqual(0);
    expect(end, `${spec} has an unterminated standard-attribute block`).toBeGreaterThan(begin);
    return source.slice(begin, end);
  };

  const firstDifference = (titles: readonly string[]): string => {
    const length = Math.max(titles.length, CANONICAL_TITLES.length);
    for (let index = 0; index < length; index++) {
      if (titles[index] !== CANONICAL_TITLES[index]) {
        return `test ${index + 1} is ${JSON.stringify(titles[index])}, expected ${JSON.stringify(CANONICAL_TITLES[index])}`;
      }
    }
    return "";
  };

  it.each(Object.entries(SPECS))(
    "%s carries exactly the canonical tests, in order",
    (sdk, spec) => {
      const titles = [...blockOf(spec).matchAll(TITLE)].map((match) => match[2]!);
      expect(
        firstDifference(titles),
        `${sdk} has ${titles.length} tests, expected ${CANONICAL_TITLES.length}`,
      ).toBe("");
    },
  );

  it.each(Object.entries(SPECS))(
    "%s carries the same test bodies as the React spec",
    (sdk, spec) => {
      expect(blockOf(spec), `${sdk} differs from the React block`).toBe(
        blockOf(SPECS["sdk-react"]),
      );
    },
  );
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
        "packages/sdk-react/src/index.spec.tsx",
        "packages/sdk-vue/src/components.spec.ts",
        "packages/sdk-angular/src/lib/components.spec.ts",
        "packages/sdk-svelte/src/index.spec.ts",
        "packages/sdk-solid/src/index.spec.tsx",
        "packages/sdk-qwik/src/index.spec.tsx",
        "packages/sdk-*/src/__tests__/*.test.ts",
        "packages/sdk-*/src/__tests__/*/*.test.ts",
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

  // Every SDK's agent skill has the same sections in the same order, so an agent
  // finds the same answer under the same heading in whichever skill it loads.
  const SKILL_HEADINGS = [
    "When to use",
    "Install",
    "Integrate",
    "Widget props and events",
    "Read these, don't guess",
    "Gotchas",
  ];

  it.each(sdkDirs.filter((dir) => existsSync(`${packagesDir}${dir}/skills`)))(
    "%s skill has the canonical sections",
    (dir) => {
      const skillsDir = `${packagesDir}${dir}/skills`;
      const [skill] = readdirSync(skillsDir);
      const outsideFences = read(`${skillsDir}/${skill}/SKILL.md`).replace(
        /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm,
        "",
      );
      const headings = [...outsideFences.matchAll(/^(#{1,6}) (.+)$/gm)];
      expect(headings.filter((match) => match[1] === "#").map((match) => match[2])).toEqual([
        `@zitadel/${dir}`,
      ]);
      expect(headings.filter((match) => match[1] === "##").map((match) => match[2])).toEqual(
        SKILL_HEADINGS,
      );
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

describe("SDK READMEs ↔ opening structure", () => {
  // Vitest runs with the package directory as cwd; `import.meta.url` is rewritten under jsdom.
  const packagesDir = `${resolve(process.cwd(), "..")}/`;
  const readmeDirs = readdirSync(packagesDir).filter(
    (dir) => dir.startsWith("sdk-") && dir !== "sdk-core",
  );

  const headings = (dir: string): { title: string[]; sections: string[] } => {
    let fenced = false;
    const title: string[] = [];
    const sections: string[] = [];
    for (const line of readFileSync(`${packagesDir}${dir}/README.md`, "utf8").split("\n")) {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      else if (!fenced && line.startsWith("# ")) title.push(line.slice(2).trim());
      else if (!fenced && line.startsWith("## ")) sections.push(line.slice(3).trim());
    }
    return { title, sections };
  };

  it("covers all twelve framework SDKs", () => {
    expect(readmeDirs).toHaveLength(12);
  });

  // The TypeScript floor is stated once, in packages/AGENTS.md; every README links it
  // instead of restating the reason, so six copies cannot drift.
  it.each(readmeDirs)(
    "%s README lists its peer dependencies as the manifest declares them",
    (dir) => {
      const readme = readFileSync(`${packagesDir}${dir}/README.md`, "utf8");
      const requirements = readme.slice(readme.indexOf("## Requirements"));
      const peers = JSON.parse(readFileSync(`${packagesDir}${dir}/package.json`, "utf8")) as {
        peerDependencies?: Record<string, string>;
      };
      expect(requirements).toContain("Peer dependencies:");
      for (const name of Object.keys(peers.peerDependencies ?? {})) {
        expect(requirements, `${dir} README does not mention ${name}`).toContain(name);
      }
    },
  );

  it.each(readmeDirs)("%s README links the shared TypeScript floor", (dir) => {
    const readme = readFileSync(`${packagesDir}${dir}/README.md`, "utf8");
    const requirements = readme.slice(readme.indexOf("## Requirements"));
    expect(requirements).toContain(
      "TypeScript ≥ 5.0, the floor shared by every SDK; see the [compatibility notes](https://github.com/zitadel/nextgen/blob/main/packages/AGENTS.md).",
    );
    expect(readme).not.toContain("export type *");
  });

  it.each(readmeDirs)("%s README opens with its title, Installation and Requirements", (dir) => {
    const { title, sections } = headings(dir);
    expect(title[0]).toBe(`@zitadel/${dir}`);
    expect(sections.slice(0, 2)).toEqual(["Installation", "Requirements"]);
  });
});

/**
 * The server SDKs' test titles.
 *
 * The six meta-framework SDKs test the same server behaviours, so their test
 * files carry exactly the same tests: the same titles, in the same order, with
 * none missing and none extra. A behaviour tested under another title, left
 * untested in one SDK, or tested only in one shows up here instead of drifting
 * unnoticed.
 */
describe("server SDK test titles", () => {
  const packagesPath = `${resolve(process.cwd(), "..")}/`;
  const TEST_FILES = {
    "sdk-next": "sdk-next/src/__tests__/middleware.test.ts",
    "sdk-nuxt": "sdk-nuxt/src/__tests__/server/middleware.test.ts",
    "sdk-sveltekit": "sdk-sveltekit/src/__tests__/handle.test.ts",
    "sdk-solid-start": "sdk-solid-start/src/__tests__/middleware.test.ts",
    "sdk-qwik-city": "sdk-qwik-city/src/__tests__/request-handler.test.ts",
    "sdk-tanstack-start": "sdk-tanstack-start/src/__tests__/middleware.test.ts",
  } as const;

  const CANONICAL_TITLES = [
    "public route with no token continues as unauthenticated",
    "protected route with no token redirects to /login?next=/admin",
    "protected route with a query string redirects to /login?next=/admin?tab=x",
    "does not nest a next parameter the request already carries",
    "protected route requested with a trailing slash redirects to login",
    "protected route with a valid cookie token authenticates",
    "protected route with a valid Bearer token authenticates",
    "Bearer token takes precedence over the session cookie",
    "token with no sub claim is treated as unauthenticated",
    "token with no sub claim is rejected on a protected route",
    "token with no sub claim continues as unauthenticated on a public route",
    "token with a disallowed typ is rejected",
    "token with a disallowed algorithm is rejected",
    'token with alg "none" is rejected without fetching JWKS',
    "RS256 tokens are accepted by default",
    "redirect preserves existing query params in loginPath",
    "invalid token clears the stale session cookie and redirects",
    "accepts a relative loginPath and redirects correctly",
    "absolute loginPath throws",
    "protocol-relative loginPath throws",
    "refuses a request that carries the auth header on the proxy path",
    "forwards upstream Set-Cookie headers",
    "forwards an upstream Location %s onto this app as %s",
    "keeps a caller-supplied credential on the handoff exchange",
    "appends the client IP to an existing X-Forwarded-For chain",
    "sets X-Forwarded-For from the client IP when no chain exists",
    "omits X-Forwarded-For when no client IP is available",
    "ignores a client-supplied x-real-ip when the runtime provides an address",
    "ignores a client-supplied x-real-ip when an X-Forwarded-For chain exists",
    "does not proxy a path that only shares the prefix without a separator",
    "skips auth handling on an ignored route",
    "hands the auth result to the next handler when the request continues",
    "reads a missing session from %j as signed out",
    "returns the redirect without continuing on a protected route miss",
    "is assignable to the framework's request handler type",
    "signs in a live session that names a user",
    "redirects an anonymous session on a protected route to login",
    "keeps an anonymous session's cookie, since its sign-in may still complete",
    "clears a dead session cookie on a public page",
    "clears a dead session cookie and redirects on a protected route",
    "clears the cookie of a session that is gone",
    "when the session check gets %s",
    "keeps the session cookie and renders a public page signed out",
    "answers 503 on a protected route and keeps the session cookie",
    "does not attach the project secret to %s %s",
    "attaches the project secret only to POST /sessions/exchange, ignoring the query",
    "preserves the upstream session cache policy",
    "keeps the path but never the internal host of an upstream redirect",
    "ignores a client-injected x-middleware-override-headers",
    "proxies an exact match of proxyPath",
    "proxies paths under proxyPath",
    "refuses a request that carries the auth header",
    "refuses a request that carries the auth header on an ignored route",
    "lets a request without the auth header through",
    "sends the exchange bearer from %s",
    "proxies to the backend from %s",
  ];

  // Matches `it("title"`, `it.fails("title"` and the `it.each([...])("title"` form.
  const TITLE = /(?:\bit(?:\.fails)?\(|\]\)\()\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

  const titlesOf = (sdk: keyof typeof TEST_FILES): string[] =>
    [...readFileSync(`${packagesPath}${TEST_FILES[sdk]}`, "utf8").matchAll(TITLE)].map(
      (match) => match[2]!,
    );

  const firstDifference = (titles: readonly string[]): string => {
    const length = Math.max(titles.length, CANONICAL_TITLES.length);
    for (let index = 0; index < length; index++) {
      if (titles[index] !== CANONICAL_TITLES[index]) {
        return `test ${index + 1} is ${JSON.stringify(titles[index])}, expected ${JSON.stringify(CANONICAL_TITLES[index])}`;
      }
    }
    return "";
  };

  it.each(Object.keys(TEST_FILES) as (keyof typeof TEST_FILES)[])(
    "%s carries exactly the canonical tests, in the canonical order",
    (sdk) => {
      const titles = titlesOf(sdk);
      expect(
        firstDifference(titles),
        `${sdk} has ${titles.length} tests, expected ${CANONICAL_TITLES.length}`,
      ).toBe("");
    },
  );
});
