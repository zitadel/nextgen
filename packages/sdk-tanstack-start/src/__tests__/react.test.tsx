import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configureZitadel } from "@zitadel/api/config";
import * as sdkReact from "@zitadel/sdk-react";
import { act, createElement, createRef, type ElementType } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type {
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowStepDetail,
  ZitadelLoginConfig,
  ZitadelLoginProps,
  ZitadelLoginReactProps,
  ZitadelLogoutConfig,
  ZitadelLogoutProps,
  ZitadelLogoutReactProps,
  ZitadelSessionConfig,
  ZitadelSessionProps,
  ZitadelSessionReactProps,
  ZitadelSignoutDetail,
} from "../react";
import * as tanstackReact from "../react";
import { ZitadelLogin, ZitadelLogout, ZitadelSession } from "../react";
import { widgetTags } from "@zitadel/sdk-core/types";

// React only flushes effects synchronously inside act() when it knows it runs
// under a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project = configureZitadel({ projectId: "proj_1", proxyPath: "/__nextgen" });

let fetchCalls: { url: string; body: string }[];
let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  // The stubbed backend answers 503, which the widget reports on the console.
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const body = input instanceof Request ? await input.clone().text() : String(init?.body ?? "");
      fetchCalls.push({ url, body });
      return Response.json({ code: "unavailable" }, { status: 503 });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Lets the element's startup microtasks and the stubbed fetch settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function flowPurposes(): string[] {
  return fetchCalls
    .filter((call) => new URL(call.url, "http://localhost").pathname === "/__nextgen/flow")
    .map((call) => (JSON.parse(call.body) as { purpose?: string }).purpose ?? "");
}

/**
 * The names a package entry exports for types only: everything its published
 * declarations export, minus what its JavaScript exports at runtime.
 */
function typeOnlyExports(specifier: string, runtime: object): string[] {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    skipLibCheck: true,
    noEmit: true,
  };
  const from = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
  const resolved = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule;
  if (!resolved) throw new Error(`cannot resolve ${specifier}`);
  const program = ts.createProgram([resolved.resolvedFileName], options);
  const source = program.getSourceFile(resolved.resolvedFileName);
  const entry = source && program.getTypeChecker().getSymbolAtLocation(source);
  if (!entry) throw new Error(`${specifier} has no module symbol`);
  const values = new Set(Object.keys(runtime));
  return program
    .getTypeChecker()
    .getExportsOfModule(entry)
    .map((symbol) => symbol.name)
    .filter((name) => !values.has(name))
    .sort();
}

const register = () =>
  createElement(ZitadelLogin, { project, purpose: "register", variant: "page" });

describe("@zitadel/sdk-tanstack-start/react", () => {
  it.each([
    ["ZitadelLogin", ZitadelLogin],
    ["ZitadelLogout", ZitadelLogout],
    ["ZitadelSession", ZitadelSession],
  ])("renders no %s markup on the server", (_name, Widget) => {
    expect(renderToString(createElement(Widget as ElementType, { project }))).toBe("");
  });

  it("starts no flow before hydration", async () => {
    container.innerHTML = renderToString(register());
    await settle();

    expect(fetchCalls).toEqual([]);
  });

  it("starts one flow, with the requested purpose, once hydrated", async () => {
    container.innerHTML = renderToString(register());
    await settle();
    await act(async () => {
      root = hydrateRoot(container, register());
    });
    await settle();

    expect(flowPurposes()).toEqual(["register"]);
  });

  it("binds the props before the hydrated widget starts", async () => {
    container.innerHTML = renderToString(register());
    await act(async () => {
      root = hydrateRoot(container, register());
    });
    await settle();

    const element = container.querySelector(widgetTags.login) as HTMLElement & {
      purpose: string;
      variant: string;
    };
    expect([element.purpose, element.variant]).toEqual(["register", "page"]);
  });

  it("mounts at once on a client render", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(register());
    });
    await settle();

    expect(flowPurposes()).toEqual(["register"]);
  });

  it.each([
    ["ZitadelLogin", ZitadelLogin, widgetTags.login],
    ["ZitadelLogout", ZitadelLogout, widgetTags.logout],
    ["ZitadelSession", ZitadelSession, widgetTags.session],
  ])("forwards a ref on %s to the element", async (_name, Widget, tag) => {
    const ref = createRef<HTMLElement>();
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(Widget as ElementType, { project, ref }));
    });

    expect(ref.current?.localName).toBe(tag);
  });

  it.each([
    ["ZitadelLogin", ZitadelLogin],
    ["ZitadelLogout", ZitadelLogout],
    ["ZitadelSession", ZitadelSession],
  ])("keeps the %s display name", (name, Widget) => {
    expect(Widget.displayName).toBe(name);
  });

  it("re-exports @zitadel/sdk-react's business copy overlay", () => {
    expect(tanstackReact.businessLocales).toBe(sdkReact.businessLocales);
  });

  it("exports every type @zitadel/sdk-react exports", () => {
    expect(typeOnlyExports("@zitadel/sdk-tanstack-start/react", tanstackReact)).toEqual(
      typeOnlyExports("@zitadel/sdk-react", sdkReact),
    );
  }, 30_000);

  it("exports the widget event details and props as @zitadel/sdk-react's", () => {
    expectTypeOf<ZitadelFlowStepDetail>().toEqualTypeOf<sdkReact.ZitadelFlowStepDetail>();
    expectTypeOf<ZitadelFlowInputDetail>().toEqualTypeOf<sdkReact.ZitadelFlowInputDetail>();
    expectTypeOf<ZitadelFlowCompleteDetail>().toEqualTypeOf<sdkReact.ZitadelFlowCompleteDetail>();
    expectTypeOf<ZitadelFlowRedirectDetail>().toEqualTypeOf<sdkReact.ZitadelFlowRedirectDetail>();
    expectTypeOf<ZitadelFlowErrorDetail>().toEqualTypeOf<sdkReact.ZitadelFlowErrorDetail>();
    expectTypeOf<ZitadelSignoutDetail>().toEqualTypeOf<sdkReact.ZitadelSignoutDetail>();
    expectTypeOf<ZitadelLoginProps>().toEqualTypeOf<sdkReact.ZitadelLoginProps>();
    expectTypeOf<ZitadelLoginReactProps>().toEqualTypeOf<sdkReact.ZitadelLoginReactProps>();
    expectTypeOf<ZitadelLogoutProps>().toEqualTypeOf<sdkReact.ZitadelLogoutProps>();
    expectTypeOf<ZitadelLogoutReactProps>().toEqualTypeOf<sdkReact.ZitadelLogoutReactProps>();
    expectTypeOf<ZitadelSessionProps>().toEqualTypeOf<sdkReact.ZitadelSessionProps>();
    expectTypeOf<ZitadelSessionReactProps>().toEqualTypeOf<sdkReact.ZitadelSessionReactProps>();
  });
});

// Every config key set to a distinct value. `Required<…>` makes `tsc` fail here
// when a key is added to a config type, so a new key cannot skip this check.
const loginConfig: Required<ZitadelLoginConfig> = {
  project,
  projectId: "proj-parity",
  proxyPath: "/__parity",
  variant: "page",
  theme: "dark",
  suppressHeader: true,
  suppressPasswordToggle: true,
  purpose: "register",
  flowName: "parity-flow",
  postSignInUrl: "/parity-after-login",
  forcePostSignInUrl: true,
  resumeFlowId: "flow_parity",
  locales: { en: { "identifier.title": "Parity" } },
  lang: "de",
};

const sessionConfig: Required<ZitadelSessionConfig> = {
  project,
  projectId: "proj-parity",
  proxyPath: "/__parity",
  postSignOutUrl: "/parity-after-sign-out",
  heading: "Parity heading",
  logoutLabel: "Parity sign out",
  variant: "page",
  theme: "dark",
  suppressHeader: true,
};

const logoutConfig: Required<ZitadelLogoutConfig> = {
  project,
  projectId: "proj-parity",
  proxyPath: "/__parity",
  postSignOutUrl: "/parity-after-sign-out",
  theme: "dark",
};

// The element's value for each key, so a key the wrapper drops shows up by name.
const elementValues = (el: object, config: object): Record<string, unknown> =>
  Object.fromEntries(Object.keys(config).map((key) => [key, (el as Record<string, unknown>)[key]]));

describe("wrapper config parity", () => {
  it.each([
    ["ZitadelLoginConfig", widgetTags.login, ZitadelLogin, loginConfig],
    ["ZitadelSessionConfig", widgetTags.session, ZitadelSession, sessionConfig],
    ["ZitadelLogoutConfig", widgetTags.logout, ZitadelLogout, logoutConfig],
  ])("forwards every %s key to <%s>", async (_name, tag, Widget, config) => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(Widget as ElementType, config));
    });

    expect(elementValues(container.querySelector(tag) as Element, config)).toEqual(config);
  });
});
