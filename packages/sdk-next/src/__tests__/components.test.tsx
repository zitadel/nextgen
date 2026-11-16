import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it as base, vi } from "vitest";

import { configureZitadel } from "../client";
import { ZitadelLogin } from "../components";

/**
 * `it` extended with `render`, which hydrates server markup into a host div and
 * unmounts the root and removes the host when the test ends.
 */
const it = base.extend<{
  render: (markup: string, widget: ReactNode) => Promise<HTMLElement>;
}>({
  /**
   * Provides the `render` function and tears down everything it mounted.
   *
   * @param _context The fixtures this one depends on, none.
   * @param use Hands the value to the test.
   * @returns Resolves once the test and the teardown have finished.
   */
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  render: async ({}, use) => {
    const mounted: { container: HTMLElement; unmount: () => void }[] = [];
    await use(async (markup, widget) => {
      const container = document.createElement("div");
      container.innerHTML = markup;
      document.body.append(container);
      await act(async () => {
        const root = hydrateRoot(container, widget);
        mounted.push({ container, unmount: () => root.unmount() });
      });
      return container;
    });
    for (const { container, unmount } of mounted) {
      await act(async () => {
        unmount();
      });
      container.remove();
    }
  },
});

describe("the components entry", () => {
  it("is a client entry", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../components.ts"), "utf8");
    expect(source.startsWith('"use client"')).toBe(true);
  });

  it("keeps the project and the locales through hydration", async ({ render }) => {
    const project = configureZitadel({ projectId: "proj-1", proxyPath: "/__nextgen" });
    const locales = { en: { "identifier.title": "Welcome back" } };
    const widget = <ZitadelLogin project={project} locales={locales} purpose="login" />;
    // The server renders without a DOM, so render the markup as it does.
    vi.stubGlobal("document", undefined);
    const markup = renderToString(widget);
    vi.unstubAllGlobals();
    const container = await render(markup, widget);

    const element = container.querySelector("zitadel-login");
    expect(element?.getAttribute("project-id")).toBe("proj-1");
    expect(element?.getAttribute("proxy-path")).toBe("/__nextgen");
    expect(element).toHaveProperty("locales", locales);
    expect(element?.getAttribute("locales")).toBeNull();
  });
});
