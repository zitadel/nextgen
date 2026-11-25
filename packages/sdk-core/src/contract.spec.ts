// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
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
 * The `packages/` directory, located from this file rather than from the process's working
 * directory, so the guards below read the same folders whichever directory vitest starts in.
 */
const PACKAGES_ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * The directories of the thirteen SDKs the guards below iterate over.
 */
const EXPECTED_SDK_DIRS = [
  "sdk-angular",
  "sdk-core",
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
];

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
    if (!decl.state) {
      names.push(String(prop));
    }
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
 * A published package's declaration map names its `../src` files, so it only
 * resolves when the package publishes `src` as well; otherwise it is a file in
 * every tarball that points at nothing.
 */
describe("published packages ↔ declaration maps", () => {
  const packagesDir = `${PACKAGES_ROOT}/`;
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
  const packagesDir = `${PACKAGES_ROOT}/`;
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
  const appsDir = `${resolve(PACKAGES_ROOT, "..")}/apps/`;
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
  const packagesDir = `${PACKAGES_ROOT}/`;
  const readmeDirs = readdirSync(packagesDir).filter(
    (dir) => dir.startsWith("sdk-") && dir !== "sdk-core",
  );

  const headings = (dir: string): { title: string[]; sections: string[] } => {
    let fenced = false;
    const title: string[] = [];
    const sections: string[] = [];
    for (const line of readFileSync(`${packagesDir}${dir}/README.md`, "utf8").split("\n")) {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
      } else if (!fenced && line.startsWith("# ")) {
        title.push(line.slice(2).trim());
      } else if (!fenced && line.startsWith("## ")) {
        sections.push(line.slice(3).trim());
      }
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
  "/*",
  " * Registers <zitadel-login>, <zitadel-logout> and <zitadel-session> in the browser.",
  " * The edge build of the components package has no elements, so this does nothing there.",
  " */",
  'import "@zitadel/components";',
].join("\n");

const EXPORT_BLOCK = [
  "/*",
  " * Re-exported so scaffolded apps can wire the business copy overlay without a",
  " * direct @zitadel/components dependency (strict package managers reject those).",
  " */",
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
  const packagesDir = `${PACKAGES_ROOT}/`;
  const ENTRIES: [string, string][] = [
    ["sdk-react", "sdk-react/src/index.tsx"],
    ["sdk-vue", "sdk-vue/src/index.ts"],
    ["sdk-angular", "sdk-angular/src/public-api.ts"],
    ["sdk-svelte", "sdk-svelte/src/lib/index.ts"],
    ["sdk-solid", "sdk-solid/src/index.tsx"],
    ["sdk-qwik", "sdk-qwik/src/index.tsx"],
    ["sdk-next", "sdk-next/src/client.ts"],
    ["sdk-nuxt", "sdk-nuxt/src/index.ts"],
    ["sdk-tanstack-start", "sdk-tanstack-start/src/components.tsx"],
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
 * Every edge project is declared the same way: the shared `edgeProject()` from
 * `@zitadel/vitest-config`, right under one shared comment.
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

describe("edge project declarations", () => {
  const packagesDir = `${PACKAGES_ROOT}/`;
  const read = (path: string): string => readFileSync(`${packagesDir}${path}`, "utf8");

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

/**
 * Each SDK spec runs the shared cases of its contract package: one that stops
 * calling them, or moves where neither Vitest nor this check looks, would drop
 * them without a failing test. The SDKs checked are the ones whose manifests
 * depend on a contract package, so a new one cannot be left out, and each needs
 * the edge to that package's `typecheck`, without which a contract edit leaves
 * its cached test results in place.
 */
describe("SDK specs ↔ the contract packages", () => {
  const packagesDir = `${PACKAGES_ROOT}/`;
  const read = (path: string): string => readFileSync(`${packagesDir}${path}`, "utf8");
  type Task = { dependsOn?: string[]; inputs?: string[] };
  /** A package's turbo tasks: its turbo.json, read as JSON without its comment lines. */
  const tasksOf = (dir: string): Record<string, Task> =>
    JSON.parse(read(`${dir}/turbo.json`).replace(/^\s*\/\/.*$/gm, "")).tasks;

  const CALLS: Record<string, Record<string, readonly string[]>> = {
    "@zitadel/server-sdk-contract": {
      "describeServerMiddleware(": [
        "sdk-next/src/__tests__/middleware.test.ts",
        "sdk-nuxt/src/__tests__/server/middleware.test.ts",
        "sdk-sveltekit/src/__tests__/handle.test.ts",
        "sdk-solid-start/src/__tests__/middleware.test.ts",
        "sdk-qwik-router/src/__tests__/request-handler.test.ts",
        "sdk-tanstack-start/src/__tests__/middleware.test.ts",
      ],
      "describeEdgeServer(": [
        "sdk-next/src/__tests__/middleware.edge.test.ts",
        "sdk-nuxt/src/__tests__/server/middleware.edge.test.ts",
        "sdk-sveltekit/src/__tests__/handle.edge.test.ts",
        "sdk-solid-start/src/__tests__/middleware.edge.test.ts",
        "sdk-qwik-router/src/__tests__/request-handler.edge.test.ts",
        "sdk-tanstack-start/src/__tests__/middleware.edge.test.ts",
      ],
      "describeClientEntry(": [
        "sdk-next/src/__tests__/client.test.ts",
        "sdk-nuxt/src/__tests__/client.test.ts",
        "sdk-sveltekit/src/__tests__/client.test.ts",
        "sdk-qwik-router/src/__tests__/client.test.ts",
        "sdk-solid-start/src/__tests__/client.test.ts",
        "sdk-tanstack-start/src/__tests__/client.test.ts",
      ],
    },
    "@zitadel/client-sdk-contract": {
      "describeEdgeEntry(": [
        "sdk-react/src/index.edge.spec.tsx",
        "sdk-vue/src/index.edge.spec.ts",
        "sdk-angular/src/public-api.edge.spec.ts",
        "sdk-svelte/src/index.edge.spec.ts",
        "sdk-solid/src/index.edge.spec.tsx",
        "sdk-qwik/src/index.edge.spec.tsx",
        "sdk-next/src/__tests__/client.edge.test.ts",
      ],
      // `@zitadel/sdk-next/client` renders no widget: Next renders through the
      // React SDK's components, which sdk-react's own edge spec covers.
      "describeEdgeRender(": [
        "sdk-react/src/index.edge.spec.tsx",
        "sdk-vue/src/index.edge.spec.ts",
        "sdk-angular/src/public-api.edge.spec.ts",
        "sdk-svelte/src/index.edge.spec.ts",
        "sdk-solid/src/index.edge.spec.tsx",
        "sdk-qwik/src/index.edge.spec.tsx",
      ],
      "describeServerRenderCases(": [
        "sdk-react/src/index.spec.tsx",
        "sdk-vue/src/components.spec.ts",
        "sdk-angular/src/lib/components.spec.ts",
        "sdk-svelte/src/index.ssr.spec.ts",
        "sdk-solid/src/index.ssr.spec.tsx",
        "sdk-qwik/src/index.ssr.spec.tsx",
      ],
      // Angular's component tag already is the element that carries the standard
      // attributes, so its wrapper forwards none and runs neither of the two
      // standard-attribute cases; it runs every other shared case.
      "describeServerStandardAttributes(": [
        "sdk-react/src/index.spec.tsx",
        "sdk-vue/src/components.spec.ts",
        "sdk-svelte/src/index.ssr.spec.ts",
        "sdk-solid/src/index.ssr.spec.tsx",
        "sdk-qwik/src/index.ssr.spec.tsx",
      ],
      "describeSharedConfigHelpers(": [
        "sdk-react/src/index.spec.tsx",
        "sdk-vue/src/components.spec.ts",
        "sdk-angular/src/lib/components.spec.ts",
        "sdk-svelte/src/index.spec.ts",
        "sdk-solid/src/index.spec.tsx",
        "sdk-qwik/src/index.spec.tsx",
      ],
      "describeStandardAttributes<": [
        "sdk-react/src/index.spec.tsx",
        "sdk-vue/src/components.spec.ts",
        "sdk-svelte/src/index.spec.ts",
        "sdk-solid/src/index.spec.tsx",
        "sdk-qwik/src/index.spec.tsx",
      ],
    },
  };
  const specs = Object.values(CALLS).flatMap((calls) =>
    Object.entries(calls).flatMap(([call, paths]) => paths.map((path) => [path, call] as const)),
  );

  it.each(specs)("%s calls %s", (path, call) => {
    expect(read(path)).toContain(call);
  });

  it.each(Object.keys(CALLS))(
    "%s runs in every SDK that depends on it, with its edge",
    (contract) => {
      const dependents = readdirSync(packagesDir).filter(
        (dir) =>
          existsSync(`${packagesDir}${dir}/package.json`) &&
          JSON.parse(read(`${dir}/package.json`)).devDependencies?.[contract] !== undefined,
      );
      const callers = new Set(
        Object.values(CALLS[contract] ?? {})
          .flat()
          .map((path) => path.slice(0, path.indexOf("/"))),
      );
      expect([...callers].sort()).toEqual(dependents.sort());
      for (const dir of dependents) {
        for (const task of ["test", "typecheck"]) {
          expect(tasksOf(dir)[task]?.dependsOn, `${dir}#${task}`).toContain(
            `${contract}#typecheck`,
          );
        }
      }
    },
  );

  it("turbo.json's test inputs list exactly the specs this check reads", () => {
    const inputs = (tasksOf("sdk-core").test?.inputs ?? [])
      .filter((input) => /\.(spec|test)\.tsx?$/.test(input))
      .map((input) => input.replace("$TURBO_ROOT$/packages/", ""));
    expect(inputs.sort()).toEqual([...new Set(specs.map(([path]) => path))].sort());
  });
});

/**
 * The public API standard of every SDK (ADR 090).
 *
 * Each `sdk-*` package declares its entries in `public-api.json`. An entry has
 * a kind, and the kind decides which names it must export; `extras` lists the
 * names its framework needs beyond those. The spec reads the real exports of
 * each entry's source file with the TypeScript compiler, so a name added,
 * renamed or dropped in an SDK fails here until the standard, or the SDK's
 * declared extras, say so.
 */
describe("SDK public API ↔ the standard", () => {
  const packagesDir = `${PACKAGES_ROOT}/`;
  const sdkDirs = readdirSync(packagesDir).filter(
    (dir) => dir.startsWith("sdk-") && dir !== "sdk-core",
  );

  type Kind = "ui" | "widgets" | "client" | "server" | "other";
  /** A name an SDK chose for something that other SDKs name differently, and why. */
  interface ReasonedName {
    readonly name: string;
    readonly why: string;
  }
  interface EntryDeclaration {
    readonly source: string;
    readonly kind: Kind;
    readonly widgets?: boolean;
    readonly handler?: ReasonedName;
    readonly authReader?: ReasonedName;
    readonly extras?: ReadonlyArray<string>;
  }
  interface PublicApi {
    readonly entries: Readonly<Record<string, EntryDeclaration>>;
  }

  const COMPONENTS = ["ZitadelLogin", "ZitadelLogout", "ZitadelSession"];
  const WIDGET_TYPES = [
    "ZitadelLoginProps",
    "ZitadelLogoutProps",
    "ZitadelSessionProps",
    "ZitadelFlowStepDetail",
    "ZitadelFlowInputDetail",
    "ZitadelFlowCompleteDetail",
    "ZitadelFlowRedirectDetail",
    "ZitadelFlowErrorDetail",
    "ZitadelSignoutDetail",
    "ZitadelFlowPurpose",
    "ZitadelFlowStep",
    "ZitadelFlowBehavior",
  ];
  const SETUP = [
    "configureZitadel",
    "getApi",
    "getZitadelConfig",
    "ZitadelProject",
    "ZitadelConfig",
  ];
  const SERVER_TYPES = [
    "ZitadelMiddlewareOptions",
    "ZitadelAuthSession",
    "AuthResult",
    "AuthState",
    "UnauthState",
    "ClientAuthResult",
  ];

  /** The names an entry must export, from its kind (ADR 090). */
  function required(entry: EntryDeclaration): string[] {
    return [...requiredByKind(entry), ...(entry.handler ? [entry.handler.name] : [])];
  }

  /** The names that the kind of an entry requires, before its declared handler. */
  function requiredByKind(entry: EntryDeclaration): string[] {
    const components = COMPONENTS;
    switch (entry.kind) {
      case "ui":
        return [...components, ...WIDGET_TYPES, ...SETUP, "businessLocales"];
      case "widgets":
        return [...components, ...WIDGET_TYPES];
      case "client":
        return [...SETUP, ...(entry.widgets ? ["businessLocales"] : [])];
      case "server":
        return [...(entry.authReader ? [entry.authReader.name] : []), ...SERVER_TYPES];
      case "other":
        return [];
    }
  }

  /** The names a source file exports, read with the package's own compiler options. */
  function exportsOf(dir: string, source: string): string[] {
    const configPath = `${packagesDir}${dir}/tsconfig.lib.json`;
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    const options = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      `${packagesDir}${dir}`,
    ).options;
    const entryFile = `${packagesDir}${dir}/${source}`;
    const program = ts.createProgram([entryFile], { ...options, noEmit: true, skipLibCheck: true });
    const checker = program.getTypeChecker();
    const file = program.getSourceFile(entryFile);
    const symbol = file ? checker.getSymbolAtLocation(file) : undefined;
    return symbol
      ? checker
          .getExportsOfModule(symbol)
          .map((exported) => exported.name)
          .sort()
      : [];
  }

  const read = (dir: string): PublicApi =>
    JSON.parse(readFileSync(`${packagesDir}${dir}/public-api.json`, "utf8")) as PublicApi;

  it.each(sdkDirs)("%s declares public-api.json", (dir) => {
    expect(existsSync(`${packagesDir}${dir}/public-api.json`)).toBe(true);
  });

  it.each(sdkDirs)("%s declares every entry its package.json exports", (dir) => {
    const exported = Object.keys(
      (
        JSON.parse(readFileSync(`${packagesDir}${dir}/package.json`, "utf8")) as {
          exports?: Record<string, unknown>;
        }
      ).exports ?? {},
    ).filter((key) => key !== "./package.json");
    expect(Object.keys(read(dir).entries).sort()).toEqual(exported.sort());
  });

  describe.each(sdkDirs)("%s", (dir) => {
    const api = existsSync(`${packagesDir}${dir}/public-api.json`) ? read(dir) : { entries: {} };
    it.each(Object.entries(api.entries))(
      "entry %s exports the standard and its declared extras, nothing else",
      (_entry, declaration) => {
        const expected = [...required(declaration), ...(declaration.extras ?? [])].sort();
        expect(exportsOf(dir, declaration.source)).toEqual(expected);
      },
      120_000,
    );
  });
});

/**
 * The documentation standard of every SDK (ADR 090): a doc comment is always a multi-line block.
 *
 * A one-line `/** text *\/` leaves no room for the reason, the behaviour or an example, and the
 * SDKs' references are read by people and by coding agents that have nothing else to go on. The
 * check reads the source of every `sdk-*` package, specs and tests excluded.
 */
describe("SDK doc comments ↔ the documentation standard", () => {
  const packagesDir = `${PACKAGES_ROOT}/`;
  const sdkDirs = readdirSync(packagesDir).filter((dir) => dir.startsWith("sdk-"));
  const SINGLE_LINE_DOC = /\/\*\*[^\n*][^\n]*\*\//;
  const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$|__tests__|test-setup|\.d\.ts$/;
  const SOURCE_FILE = /\.(ts|tsx|vue|svelte)$/;

  /** Every source file below `dir`, as paths relative to the packages directory. */
  const sourcesOf = (dir: string): string[] =>
    readdirSync(`${packagesDir}${dir}/src`, { recursive: true, encoding: "utf8" })
      .filter((file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file))
      .map((file) => `${dir}/src/${file}`);

  it.each(sdkDirs)("%s has no single-line doc comment", (dir) => {
    const offenders = sourcesOf(dir).flatMap((path) =>
      readFileSync(`${packagesDir}${path}`, "utf8")
        .split("\n")
        .flatMap((line, at) => (SINGLE_LINE_DOC.test(line) ? [`${path}:${at + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * Where the SDKs meet the API package (ADR 090).
 *
 * The API package is generated from the OpenAPI document and changes with it. So `sdk-core` is the
 * only SDK that imports it, through `config.ts`, and its public type files declare the types an app
 * can see themselves. An SDK that imported the API package directly, or a public type that named a
 * generated one, would tie that SDK's public API to every API change.
 */
describe("SDK sources ↔ the API package", () => {
  const packagesDir = `${PACKAGES_ROOT}/`;
  const sdkDirs = readdirSync(packagesDir).filter(
    (dir) => dir.startsWith("sdk-") && dir !== "sdk-core",
  );
  const API_IMPORT = /(?:from|import\()\s*["']@zitadel\/api(?:\/[^"']*)?["']/;
  const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$|__tests__|test-setup/;
  const SOURCE_FILE = /\.(ts|tsx|vue|svelte)$/;

  it.each(sdkDirs)("%s reaches the API package only through sdk-core", (dir) => {
    const offenders = readdirSync(`${packagesDir}${dir}/src`, { recursive: true, encoding: "utf8" })
      .filter((file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file))
      .filter((file) => API_IMPORT.test(readFileSync(`${packagesDir}${dir}/src/${file}`, "utf8")));
    expect(offenders).toEqual([]);
  });

  it.each(["types.ts", "config.ts"])("sdk-core's public %s names no generated type", (file) => {
    expect(readFileSync(`${packagesDir}sdk-core/src/${file}`, "utf8")).not.toMatch(
      /@zitadel\/api\/generated/,
    );
  });
});

describe("SDK directories ↔ the guards in this file", () => {
  it("finds every SDK, so no guard silently iterates over nothing", () => {
    const found = readdirSync(PACKAGES_ROOT).filter((dir) => dir.startsWith("sdk-"));
    expect(found.sort()).toEqual(EXPECTED_SDK_DIRS);
  });
});

describe("published SDK packages ↔ their contents", () => {
  const sdkDirs = readdirSync(PACKAGES_ROOT).filter(
    (dir) => dir.startsWith("sdk-") && existsSync(`${PACKAGES_ROOT}/${dir}/package.json`),
  );

  it.each(sdkDirs)("%s keeps the generated API reference out of the tarball", (dir) => {
    const manifest = JSON.parse(readFileSync(`${PACKAGES_ROOT}/${dir}/package.json`, "utf8")) as {
      files?: string[];
    };
    const files = manifest.files ?? [];
    // A negation only removes what an earlier pattern added, so it must come after `dist`.
    expect(files).toContain("dist");
    expect(files.indexOf("!dist/api-docs")).toBeGreaterThan(files.indexOf("dist"));
  });
});

/**
 * The cases every server SDK writes out in its own middleware test.
 *
 * Each block below sits in the middleware test of all six server SDKs, and the text must be the
 * same in every one. A copy that drifts means one SDK checks something its siblings do not.
 */
describe("server SDK middleware tests ↔ the blocks they share", () => {
  const files = [
    "sdk-next/src/__tests__/middleware.test.ts",
    "sdk-nuxt/src/__tests__/server/middleware.test.ts",
    "sdk-sveltekit/src/__tests__/handle.test.ts",
    "sdk-qwik-router/src/__tests__/request-handler.test.ts",
    "sdk-solid-start/src/__tests__/middleware.test.ts",
    "sdk-tanstack-start/src/__tests__/middleware.test.ts",
  ];
  const titles = [
    "protected routes and encoded paths",
    "an empty backend URL",
    "an empty project secret",
    "proxied OAuth paths of another project",
    "an unsafe login path",
    "a cleared session cookie",
    "a request with the internal auth header",
    "proxied request headers",
    "proxied requests without a body",
  ];

  /**
   * Cuts a top-level `describe` block out of a test file.
   *
   * @param path - The path of the file below `packages/`.
   * @param title - The title of the block.
   * @returns The text of the block, from `describe(` to its closing line.
   */
  const blockOf = (path: string, title: string): string => {
    const source = readFileSync(`${PACKAGES_ROOT}/${path}`, "utf8");
    const start = source.indexOf(`describe("${title}"`);
    const end = source.indexOf("\n});\n", start);
    return start === -1 || end === -1 ? "" : source.slice(start, end + 5);
  };

  it.each(titles)("%s is in every SDK, word for word", (title) => {
    const blocks = files.map((path) => blockOf(path, title));
    expect(blocks[0]).not.toBe("");
    for (const block of blocks) {
      expect(block).toBe(blocks[0]);
    }
  });
});

describe("server SDK sources ↔ the default backend URL", () => {
  const serverSdks = readdirSync(PACKAGES_ROOT).filter(
    (dir) =>
      dir.startsWith("sdk-") &&
      existsSync(`${PACKAGES_ROOT}/${dir}/package.json`) &&
      JSON.parse(readFileSync(`${PACKAGES_ROOT}/${dir}/package.json`, "utf8")).devDependencies?.[
        "@zitadel/server-sdk-contract"
      ] !== undefined,
  );

  /**
   * Lists the source files of a package that hold code, without its tests and generated output.
   *
   * @param directory - The directory to read.
   * @returns The paths of the TypeScript files below it.
   */
  const sourcesOf = (directory: string): string[] => {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return entry.name === "__tests__" ? [] : sourcesOf(path);
      }
      return /\.tsx?$/.test(entry.name) && !/\.(spec|test)\./.test(entry.name) ? [path] : [];
    });
  };

  it("finds the six server SDKs", () => {
    expect(serverSdks).toHaveLength(6);
  });

  it.each(serverSdks)("%s falls back to http://localhost:8080 and no other address", (dir) => {
    const addresses = sourcesOf(`${PACKAGES_ROOT}/${dir}/src`).flatMap((path) => {
      const code = readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join("\n");
      return [...code.matchAll(/["'`](http:\/\/localhost:\d+)["'`]/g)].map((match) => match[1]);
    });
    expect(addresses).not.toEqual([]);
    for (const address of addresses) {
      expect(address).toBe("http://localhost:8080");
    }
  });
});
