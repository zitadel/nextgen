import { configureZitadel } from "@zitadel/api/config";
import * as sdkReact from "@zitadel/sdk-react";
import { act, createElement, createRef, type ElementType } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as tanstackReact from "../react";
import { ZitadelLogin, ZitadelLogout, ZitadelSession } from "../react";

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

    const element = container.querySelector("zitadel-login") as HTMLElement & {
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
    ["ZitadelLogin", ZitadelLogin, "zitadel-login"],
    ["ZitadelLogout", ZitadelLogout, "zitadel-logout"],
    ["ZitadelSession", ZitadelSession, "zitadel-session"],
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
});
