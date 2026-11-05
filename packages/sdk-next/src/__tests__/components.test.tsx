import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { configureZitadel } from "../client";
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
