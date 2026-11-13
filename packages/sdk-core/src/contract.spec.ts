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
  standardAttributes,
  widgetTags,
} from "./types.js";

/**
 * The spec files the guards below read, by SDK: `client` is the spec that carries
 * the SDK's client-side tests, `server` the one that carries its server-markup
 * tests. Angular is not here: its wrapper forwards no standard attribute, since
 * its component tag already is the element that carries them, so it has no
 * standard-attribute block (see {@link ANGULAR_SPEC}).
 */
const SDK_SPECS = {
  "sdk-react": {
    client: "../../sdk-react/src/index.spec.tsx",
    server: "../../sdk-react/src/index.spec.tsx",
  },
  "sdk-vue": {
    client: "../../sdk-vue/src/components.spec.ts",
    server: "../../sdk-vue/src/components.spec.ts",
  },
  "sdk-svelte": {
    client: "../../sdk-svelte/src/index.spec.ts",
    server: "../../sdk-svelte/src/index.ssr.spec.ts",
  },
  "sdk-solid": {
    client: "../../sdk-solid/src/index.spec.tsx",
    server: "../../sdk-solid/src/index.ssr.spec.tsx",
  },
  "sdk-qwik": {
    client: "../../sdk-qwik/src/index.spec.tsx",
    server: "../../sdk-qwik/src/index.ssr.spec.tsx",
  },
} as const;

/** Angular's spec: it carries the shared server-render table but no standard-attribute block. */
const ANGULAR_SPEC = "../../sdk-angular/src/lib/components.spec.ts";

/** The first place two lists of test titles differ, or "" when they are the same. */
const firstDifference = (titles: readonly string[], canonical: readonly string[]): string => {
  const length = Math.max(titles.length, canonical.length);
  for (let index = 0; index < length; index++) {
    if (titles[index] !== canonical[index]) {
      return `test ${index + 1} is ${JSON.stringify(titles[index])}, expected ${JSON.stringify(canonical[index])}`;
    }
  }
  return "";
};

// Matches `it("title"`, `it.each(…)("title"`, `describe("title"` and `describe.each(…)("title"`.
const BLOCK_TITLE = /\b(?:it|describe)(?:\.each\([^)]*\))?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** Where the `// name:edge` marker comment, alone on its line, starts; -1 when there is none. */
const markerAt = (source: string, name: string, edge: "begin" | "end"): number => {
  const marker = new RegExp(`^[ \\t]*// ${name}:${edge}[ \\t]*$`, "m").exec(source);
  return marker ? marker.index + marker[0].indexOf("//") : -1;
};

const blockIn = (source: string, name: string): string | undefined => {
  const begin = markerAt(source, name, "begin");
  const end = markerAt(source, name, "end");
  return begin >= 0 && end > begin ? source.slice(begin, end) : undefined;
};

const titlesIn = (block: string): string[] =>
  Array.from(block.matchAll(BLOCK_TITLE), (match) => match[2] ?? "");

/**
 * What is wrong with the `name` blocks of the given sources: a block that is
 * missing, one whose titles are not the canonical ones, in order and without an
 * extra, and one whose body is not the first source's, byte for byte.
 */
const problems = (
  sources: Readonly<Record<string, string>>,
  name: string,
  canonical: readonly string[],
): string[] => {
  const blocks = Object.entries(sources).map(
    ([sdk, source]) => [sdk, source, blockIn(source, name)] as const,
  );
  const reference = blocks[0]?.[2];
  return blocks.flatMap(([sdk, source, block]) => {
    if (block === undefined) return [`${sdk} has no ${name} block`];
    const found = [];
    const difference = firstDifference(titlesIn(block), canonical);
    if (difference) found.push(`${sdk}: ${difference}`);
    if (block !== reference) found.push(`${sdk}: the body differs from the first SDK's`);
    const outside = titlesIn(source.replace(block, "")).filter((title) =>
      canonical.includes(title),
    );
    if (outside.length > 0)
      found.push(`${sdk}: ${JSON.stringify(outside[0])} is also tested outside the block`);
    return found;
  });
};

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
 * The tag names. `@zitadel/components` cannot depend on this package, so the
 * check lives here, where both are visible: the elements register under exactly
 * the names {@link widgetTags} defines, which every SDK reads instead of
 * spelling them out.
 */
describe("widget tags ↔ @zitadel/components", () => {
  it.each([
    ["login", ZitadelLogin],
    ["logout", ZitadelLogout],
    ["session", ZitadelSession],
  ] as const)("registers the %s element under its tag", (widget, element) => {
    expect(customElements.get(widgetTags[widget])).toBe(element);
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
    [widgetTags.login, ZitadelLogin, LOGIN_CONFIG_KEYS, LOGIN_ELEMENT_ONLY],
    [widgetTags.session, ZitadelSession, SESSION_CONFIG_KEYS, SESSION_ELEMENT_ONLY],
    [widgetTags.logout, ZitadelLogout, LOGOUT_CONFIG_KEYS, LOGOUT_ELEMENT_ONLY],
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
    SDK_SPECS["sdk-react"].client,
    SDK_SPECS["sdk-vue"].client,
    ANGULAR_SPEC,
    SDK_SPECS["sdk-svelte"].client,
    SDK_SPECS["sdk-solid"].server,
    SDK_SPECS["sdk-qwik"].server,
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
 * The standard attributes and the widget props are disjoint by construction: a
 * wrapper hands the element the standard attributes besides its own props, so
 * if a widget prop shared a name with one, the wrapper would shadow it.
 */
describe("standard attributes ↔ widget props", () => {
  it.each([
    ["ZitadelLogin", LOGIN_CONFIG_KEYS, ZITADEL_LOGIN_EVENT_HANDLERS],
    ["ZitadelLogout", LOGOUT_CONFIG_KEYS, ZITADEL_LOGOUT_EVENT_HANDLERS],
    ["ZitadelSession", SESSION_CONFIG_KEYS, ZITADEL_SESSION_EVENT_HANDLERS],
  ] as const)("%s has no prop that is a standard attribute", (_widget, configKeys, handlers) => {
    const props = {
      ...configKeys,
      ...Object.fromEntries(Object.values(handlers).map((n) => [n, true])),
    };
    expect(standardAttributes(props)).toEqual({});
  });
});

/**
 * The standard-attribute tests.
 *
 * Every SPA SDK except Angular passes the element's standard HTML attributes to
 * the widget element, and every SDK spec proves it with the same tests between
 * marker comments: the same titles, in the same order, with none missing, none
 * extra and none unmarked inside the block, and the same bodies, byte for byte.
 * Only the glue above each block (`mountWidget`, `renderAttributes` and the two
 * props type aliases) differs. A behaviour left untested in one SDK, or tested
 * under another title, fails here instead of drifting unnoticed.
 *
 * One documented exception: Angular's component tag already is the element that
 * carries the standard attributes, so its wrapper does not forward anything and
 * its spec has no block.
 */
describe("standard-attribute tests ↔ SDK specs", () => {
  const CLIENT_TITLES = [
    "%s standard attributes",
    "forwards the class to the widget element",
    "forwards the style to the widget element",
    "forwards the id to the widget element",
    "forwards data attributes to the widget element",
    "forwards aria attributes to the widget element",
    "forwards the remaining standard attributes to the widget element",
    "forwards the slot to the widget element",
    "renders a false aria or data attribute as the string false",
    "updates a forwarded attribute when the prop changes",
    "removes a forwarded attribute when the prop is removed",
    "does not forward props outside the standard set",
    "gives access to the widget element through a ref",
    "accepts the standard attributes in its props",
    "rejects the attributes it does not forward in its props",
  ];

  const SERVER_TITLES = [
    "%s server-rendered standard attributes",
    "puts the standard attributes into the server markup",
    "leaves props outside the standard set out of the server markup",
  ];

  const read = (spec: string): string =>
    readFileSync(fileURLToPath(new URL(spec, import.meta.url)), "utf8");

  const specsOf = (side: "client" | "server"): Record<string, string> =>
    Object.fromEntries(
      Object.entries(SDK_SPECS).flatMap(([sdk, specs]) => {
        const spec =
          side === "client" ? specs.client : "server" in specs ? specs.server : undefined;
        return spec === undefined ? [] : [[sdk, read(spec)]];
      }),
    );

  it.each([
    ["standard-attributes", "client", CLIENT_TITLES],
    ["standard-attributes-server", "server", SERVER_TITLES],
  ] as const)("the %s block is canonical in every SDK", (name, side, canonical) => {
    expect(problems(specsOf(side), name, canonical)).toEqual([]);
  });

  it("has no block in Angular, the one documented exception", () => {
    const angular = read(ANGULAR_SPEC);
    expect(blockIn(angular, "standard-attributes")).toBeUndefined();
    expect(blockIn(angular, "standard-attributes-server")).toBeUndefined();
  });

  // The guard's own logic, on sources it is made to reject.
  describe("the guard", () => {
    const block = [
      "// x:begin",
      'describe.each(widgetNames)("%s group", (widget) => {',
      '  it("first", () => {});',
      '  it.each([1, 2])("second", () => {});',
      "});",
      "// x:end",
    ].join("\n");
    const canonical = ["%s group", "first", "second"];
    const check = (other: string): string[] => problems({ one: block, two: other }, "x", canonical);

    it("accepts blocks that match", () => {
      expect(check(block)).toEqual([]);
    });

    it("reads it, it.each and describe.each titles", () => {
      expect(titlesIn(blockIn(block, "x") ?? "")).toEqual(canonical);
    });

    it("sees a dropped title", () => {
      expect(check(block.replace('  it("first", () => {});\n', ""))).toHaveLength(2);
    });

    it("sees a renamed title", () => {
      expect(check(block.replace('"first"', '"primary"'))).toHaveLength(2);
    });

    it("sees a reordered title", () => {
      const swapped = block
        .replace('  it("first", () => {});\n', "")
        .replace(
          '  it.each([1, 2])("second", () => {});',
          '  it.each([1, 2])("second", () => {});\n  it("first", () => {});',
        );
      expect(check(swapped)).toHaveLength(2);
    });

    it("sees an extra test inside the block", () => {
      expect(
        check(block.replace("});\n// x:end", '  it("extra", () => {});\n});\n// x:end')),
      ).toHaveLength(2);
    });

    it("sees a changed body and names it", () => {
      expect(
        check(block.replace('it("first", () => {})', 'it("first", () => { run(); })')),
      ).toEqual(["two: the body differs from the first SDK's"]);
    });

    it("sees a canonical test outside the block", () => {
      expect(check(`it("first", () => {});\n${block}`)).toEqual([
        'two: "first" is also tested outside the block',
      ]);
    });

    it("sees a block that is missing or unterminated", () => {
      expect(check("nothing here")).toEqual(["two has no x block"]);
      expect(check("// x:begin\nno end")).toEqual(["two has no x block"]);
    });
  });
});

/**
 * A published package's declaration map names its `../src` files, so it only
 * resolves when the package publishes `src` as well; otherwise it is a file in
 * every tarball that points at nothing.
 */
describe("published packages ↔ declaration maps", () => {
  const packagesDir = `${resolve(process.cwd(), "..")}/`;
  const published = readdirSync(packagesDir).filter((dir) => {
    const path = `${packagesDir}${dir}/package.json`;
    return (
      existsSync(path) &&
      (JSON.parse(readFileSync(path, "utf8")) as { private?: boolean }).private !== true
    );
  });

  it("covers the published packages", () => {
    expect(published).toEqual(expect.arrayContaining(["api", "components", "sdk-core"]));
  });

  it.each(published)("%s emits declaration maps only beside its sources", (dir) => {
    const { files = [] } = JSON.parse(
      readFileSync(`${packagesDir}${dir}/package.json`, "utf8"),
    ) as {
      files?: string[];
    };
    const tsconfig = `${packagesDir}${dir}/tsconfig.lib.json`;
    const maps =
      existsSync(tsconfig) && /"declarationMap"\s*:\s*true/.test(readFileSync(tsconfig, "utf8"));
    expect(maps && !files.some((file) => file === "src" || file.startsWith("src/"))).toBe(false);
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
    "sdk-tanstack-start",
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
  // Next's own file, which `next build` and `next dev` write: no test input.
  const SKIPPED_FILES = /^next-env\.d\.ts$/;
  const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;
  const SDK_OWNED_IMPORT =
    /(?:from|import|require)\s*\(?\s*["'](@zitadel\/(?:components|api|design-tokens))(?:\/[^"']*)?["']/;

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isDirectory()) {
        return SKIPPED_DIRS.test(entry.name) ? [] : sourceFiles(`${dir}/${entry.name}`);
      }
      return SOURCE_FILE.test(entry.name) && !SKIPPED_FILES.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : [];
    });

  // The checks above read files outside this package, so turbo.json must list
  // them as test inputs; otherwise a change there neither reruns the test nor
  // invalidates its cached result.
  it("turbo.json lists the files the checks read as test inputs", () => {
    const config = read(`${packagesDir}sdk-core/turbo.json`);
    for (const input of [
      ...new Set(
        [ANGULAR_SPEC, ...Object.values(SDK_SPECS).flatMap((specs) => Object.values(specs))].map(
          (spec) => spec.replace("../../", "packages/"),
        ),
      ),
      "packages/sdk-*/src/__tests__/*.test.ts",
      "packages/sdk-*/src/__tests__/*/*.test.ts",
      "packages/sdk-*/package.json",
      "packages/sdk-*/README.md",
      "packages/sdk-*/skills/**/SKILL.md",
      "apps/demo-*/package.json",
      "apps/demo-*/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,vue,svelte,astro}",
    ]) {
      expect(config, `turbo.json has no test input ${input}`).toContain(input);
    }
  });

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
 * What every client SDK entry holds in common about `@zitadel/components`: the
 * side-effect import that registers the elements in the browser, and the
 * `businessLocales` re-export, each with the same comment, once. Nothing else
 * of the package is re-exported: an element class (as a value or as a type)
 * would pull the elements entry into a bundle that has to load on the edge, and
 * would make one SDK export what the others do not.
 */
const IMPORT_BLOCK = [
  "// Registers <zitadel-login>, <zitadel-logout> and <zitadel-session> in the browser.",
  "// The edge build of the components package has no elements, so this does nothing there.",
  'import "@zitadel/components";',
].join("\n");

const EXPORT_BLOCK = [
  "// Re-exported so scaffolded apps can wire the business copy overlay without a",
  "// direct @zitadel/components dependency (strict package managers reject those).",
  'export { businessLocales } from "@zitadel/components";',
].join("\n");

const BUSINESS_LOCALES_EXPORT = 'export { businessLocales } from "@zitadel/components"';

/** Every `export … from "@zitadel/components"` statement of a source. */
const EXPORTS_FROM_COMPONENTS = /\bexport\s[^;]*?from\s*["']@zitadel\/components["']/g;

/** A line that imports `@zitadel/components` for its side effect, however it is written. */
const REGISTERING_IMPORT_LINE = /^\s*import\s*["']@zitadel\/components["']/;

/** A line that re-exports `businessLocales`, however it is written. */
const BUSINESS_LOCALES_LINE = /^\s*export\s*\{[^}]*\bbusinessLocales\b/;

/** How often the lines of `block` follow each other in `lines`, each matching whole and exactly. */
const blocksIn = (lines: readonly string[], block: string): number => {
  const wanted = block.split("\n");
  return lines.filter((_, at) => wanted.every((line, offset) => lines[at + offset] === line))
    .length;
};

/** What is wrong with the way a client SDK entry uses `@zitadel/components`. */
const entryProblems = (source: string): string[] => {
  const found: string[] = [];
  const lines = source.split("\n");
  if (
    blocksIn(lines, IMPORT_BLOCK) !== 1 ||
    lines.filter((line) => REGISTERING_IMPORT_LINE.test(line)).length !== 1
  ) {
    found.push("does not hold the registering import, with its comment, exactly once");
  }
  if (
    blocksIn(lines, EXPORT_BLOCK) !== 1 ||
    lines.filter((line) => BUSINESS_LOCALES_LINE.test(line)).length !== 1
  ) {
    found.push("does not hold the businessLocales re-export, with its comment, exactly once");
  }
  for (const statement of source.match(EXPORTS_FROM_COMPONENTS) ?? []) {
    if (statement !== BUSINESS_LOCALES_EXPORT) {
      found.push(`re-exports more than businessLocales: ${statement.replace(/\s+/g, " ")}`);
    }
  }
  return found;
};

describe("client SDK entries ↔ @zitadel/components", () => {
  const packagesDir = `${resolve(process.cwd(), "..")}/`;
  const ENTRIES: [string, string][] = [
    ["sdk-react", "sdk-react/src/index.tsx"],
    ["sdk-vue", "sdk-vue/src/index.ts"],
    ["sdk-angular", "sdk-angular/src/public-api.ts"],
    ["sdk-svelte", "sdk-svelte/src/lib/index.ts"],
    ["sdk-solid", "sdk-solid/src/index.tsx"],
    ["sdk-qwik", "sdk-qwik/src/index.tsx"],
    ["sdk-next", "sdk-next/src/client.ts"],
    ["sdk-nuxt", "sdk-nuxt/src/index.ts"],
    ["sdk-tanstack-start", "sdk-tanstack-start/src/react.tsx"],
  ];

  it.each(ENTRIES)("%s registers the elements and re-exports no element class", (_sdk, path) => {
    expect(entryProblems(readFileSync(`${packagesDir}${path}`, "utf8"))).toEqual([]);
  });

  describe("the guard", () => {
    const good = `${IMPORT_BLOCK}\n\n${EXPORT_BLOCK}\nexport const x = 1;\n`;

    it("accepts the canonical lines", () => {
      expect(entryProblems(good)).toEqual([]);
    });

    it("sees a missing import and a missing re-export", () => {
      expect(entryProblems(good.replace(IMPORT_BLOCK, ""))).toHaveLength(1);
      expect(entryProblems(good.replace(EXPORT_BLOCK, ""))).toHaveLength(1);
    });

    it("sees a repeated import", () => {
      expect(entryProblems(`${IMPORT_BLOCK}\n${good}`)).toHaveLength(1);
    });

    it("sees a reworded comment", () => {
      expect(entryProblems(good.replace("Registers", "Loads"))).toHaveLength(1);
    });

    it.each([
      ["a trailing comment", 'import "@zitadel/components";', 'import "@zitadel/components"; // x'],
      ["extra whitespace", 'import "@zitadel/components";', 'import  "@zitadel/components";'],
      ["trailing whitespace", 'import "@zitadel/components";', 'import "@zitadel/components"; '],
      ["an indent", 'import "@zitadel/components";', '  import "@zitadel/components";'],
      [
        "a trailing comment on the re-export",
        'export { businessLocales } from "@zitadel/components";',
        'export { businessLocales } from "@zitadel/components"; // x',
      ],
      [
        "extra whitespace in the re-export",
        'export { businessLocales } from "@zitadel/components";',
        'export {  businessLocales } from "@zitadel/components";',
      ],
    ])("sees %s", (_, line, changed) => {
      expect(entryProblems(good.replace(line, changed))).not.toEqual([]);
    });

    it("sees a second import or re-export beside the canonical lines", () => {
      expect(entryProblems(`${good}import "@zitadel/components"; // x\n`)).toHaveLength(1);
      expect(entryProblems(`${good}import '@zitadel/components';\n`)).toHaveLength(1);
      expect(
        entryProblems(`${good}export { businessLocales } from "@zitadel/components"; // x\n`),
      ).toHaveLength(1);
    });

    it.each([
      'export { ZitadelLogin } from "@zitadel/components";',
      'export type { ZitadelLogout, ZitadelSession } from "@zitadel/components";',
      'export { businessLocales, ZitadelSession } from "@zitadel/components";',
      'export * from "@zitadel/components";',
      'export {\n  ZitadelLogin,\n} from "@zitadel/components";',
    ])("sees %j", (statement) => {
      expect(entryProblems(`${good}${statement}\n`)).not.toEqual([]);
    });

    it("lets an entry import an element class as a type for its own use", () => {
      expect(
        entryProblems(`import type { ZitadelLogin } from "@zitadel/components";\n${good}`),
      ).toEqual([]);
    });
  });
});

/**
 * The client SDK edge specs. Each loads its built package inside the edge VM and
 * carries the same `edge-entry` block and, but for `@zitadel/sdk-next/client`,
 * which renders no widget, the same `edge-render` block: the same titles and the
 * same body, byte for byte. Only the render call and the imports are the
 * framework's.
 */
const EDGE_COMMENT =
  "      // Runs the edge specs in the edge-runtime VM; see edgeProject in vitest.shared.mjs.";

/** What is wrong with the way a Vitest config declares its edge project. */
const edgeConfigProblems = (source: string): string[] => {
  const lines = source.split("\n");
  const at = lines.indexOf(EDGE_COMMENT);
  const found: string[] = [];
  if (
    !lines.some((line) =>
      /^import \{[^}]*\bedgeProject\b[^}]*\} from "@zitadel\/vitest-config";$/.test(line),
    )
  ) {
    found.push("does not import edgeProject from the shared module");
  }
  if (at === -1 || lines.indexOf(EDGE_COMMENT, at + 1) !== -1) {
    found.push("does not have the shared comment exactly once");
  } else if (!(lines[at + 1] ?? "").startsWith("      edgeProject(")) {
    found.push("does not declare the edge project right under the shared comment");
  }
  return found;
};

describe("client SDK edge specs", () => {
  const packagesDir = `${resolve(process.cwd(), "..")}/`;
  const read = (path: string): string => readFileSync(`${packagesDir}${path}`, "utf8");

  const ENTRY_TITLES = [
    "the SDK entry in the edge runtime",
    "runs without a DOM",
    "keeps the locale data it re-exports",
  ];
  const EDGE_TITLES = [
    "the SDK in the edge runtime",
    "renders the login widget as its custom element with its attributes",
    "renders the session widget as its custom element with its attributes",
    "renders the logout widget as its custom element with its attributes",
    "writes the purpose and the resumed flow into the login markup",
    "omits the language when none is set",
  ];

  const WRAPPERS = {
    "sdk-react": "sdk-react/src/index.edge.spec.tsx",
    "sdk-vue": "sdk-vue/src/index.edge.spec.ts",
    "sdk-angular": "sdk-angular/src/public-api.edge.spec.ts",
    "sdk-svelte": "sdk-svelte/src/index.edge.spec.ts",
    "sdk-solid": "sdk-solid/src/index.edge.spec.tsx",
    "sdk-qwik": "sdk-qwik/src/index.edge.spec.tsx",
  };
  const NEXT = { "sdk-next": "sdk-next/src/__tests__/client.edge.test.ts" };

  const sourcesOf = (specs: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(specs).map(([sdk, path]) => [sdk, read(path)]));

  it("has the entry block in every client SDK, sdk-next included", () => {
    expect(problems(sourcesOf({ ...WRAPPERS, ...NEXT }), "edge-entry", ENTRY_TITLES)).toEqual([]);
  });

  it("has the render block in every SDK that renders widgets", () => {
    expect(problems(sourcesOf(WRAPPERS), "edge-render", EDGE_TITLES)).toEqual([]);
  });

  it("declares the edge project the same way in every config", () => {
    const configs = [
      "components",
      "sdk-angular",
      "sdk-next",
      "sdk-nuxt",
      "sdk-qwik",
      "sdk-qwik-router",
      "sdk-react",
      "sdk-solid",
      "sdk-solid-start",
      "sdk-svelte",
      "sdk-sveltekit",
      "sdk-tanstack-start",
      "sdk-vue",
    ].map((dir) => `${dir}/vitest.config.ts`);
    expect(
      [...configs, "sdk-core/vite.config.ts"].flatMap((path) =>
        edgeConfigProblems(read(path)).map((problem) => `${path}: ${problem}`),
      ),
    ).toEqual([]);
  });

  describe("the config guard", () => {
    const good = `import { baseTest, edgeProject } from "@zitadel/vitest-config";\n${EDGE_COMMENT}\n      edgeProject({}),\n`;

    it("accepts the shared import and comment", () => {
      expect(edgeConfigProblems(good)).toEqual([]);
    });

    it("sees a missing import, a missing, repeated or reworded comment and a detached call", () => {
      expect(edgeConfigProblems(good.replace("edgeProject }", "baseTest }"))).toHaveLength(1);
      expect(edgeConfigProblems(good.replace(EDGE_COMMENT, ""))).not.toEqual([]);
      expect(edgeConfigProblems(`${good}${EDGE_COMMENT}\n`)).not.toEqual([]);
      expect(edgeConfigProblems(good.replace("Runs", "Run"))).not.toEqual([]);
      expect(edgeConfigProblems(good.replace("      edgeProject", "      other"))).toHaveLength(1);
    });
  });
});
