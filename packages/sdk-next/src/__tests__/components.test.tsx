import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "@testing-library/react";
import * as ui from "@zitadel/sdk-react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { configureZitadel } from "../client";
import * as entry from "../components";
import { ZitadelLogin } from "../components";

describe("the components entry", () => {
  it("is a client entry", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../components.ts"), "utf8");
    expect(source.startsWith('"use client"')).toBe(true);
  });

  it("keeps the project and the locales through hydration", async () => {
    const project = configureZitadel({ projectId: "proj-1", proxyPath: "/__nextgen" });
    const locales = { en: { "identifier.title": "Welcome back" } };
    const widget = <ZitadelLogin project={project} locales={locales} purpose="login" />;
    const container = document.createElement("div");
    // The server renders without a DOM, so render the markup as it does.
    vi.stubGlobal("document", undefined);
    const markup = renderToString(widget);
    vi.unstubAllGlobals();
    container.innerHTML = markup;
    document.body.append(container);

    await act(async () => {
      hydrateRoot(container, widget);
    });

    const element = container.querySelector("zitadel-login");
    expect(element?.getAttribute("project-id")).toBe("proj-1");
    expect(element?.getAttribute("proxy-path")).toBe("/__nextgen");
    expect(element).toHaveProperty("locales", locales);
    expect(element?.getAttribute("locales")).toBeNull();
    container.remove();
  });
});

const VALUES = [
  "ZitadelLogin",
  "ZitadelLogout",
  "ZitadelSession",
  "configureZitadel",
  "businessLocales",
] as const;

const entryExports = entry as Record<string, unknown>;
const uiExports = ui as Record<string, unknown>;

describe("@zitadel/sdk-next/components", () => {
  it.each(VALUES)("exports %s as the very object @zitadel/sdk-react exports", (name) => {
    expect(entryExports[name]).toBeDefined();
    expect(entryExports[name]).toBe(uiExports[name]);
  });

  it("exports no value that @zitadel/sdk-react does not", () => {
    expect(Object.keys(entryExports).filter((name) => !(name in uiExports))).toEqual([]);
  });

  it("exports exactly the widget values the standard requires", () => {
    expect(Object.keys(entryExports).sort()).toEqual([...VALUES].sort());
  });
});
