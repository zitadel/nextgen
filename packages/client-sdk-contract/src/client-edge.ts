import type { WidgetName } from "@zitadel/sdk-core/types";

import { describe, expect, it } from "vitest";

/**
 * Loads the built package, as a consumer's bundler resolves it, inside the
 * `edge-runtime` VM (the `edge` project in `vitest.config.ts`), which has no
 * `HTMLElement`, `document` or `customElements`, with dependencies resolved the
 * way a bundler resolves them for the edge.
 */
export function describeEdgeEntry(businessLocales: object): void {
  describe("the SDK entry in the edge runtime", () => {
    it("runs without a DOM", () => {
      expect(typeof HTMLElement).toBe("undefined");
      expect(typeof document).toBe("undefined");
      expect(typeof customElements).toBe("undefined");
    });

    it("keeps the locale data it re-exports", () => {
      expect(Object.keys(businessLocales).length).toBeGreaterThan(0);
    });
  });
}

/**
 * Renders `widget` with `props` through the SDK's built component, the way its
 * framework renders on a server, and returns the markup.
 */
export type EdgeRender = (
  widget: WidgetName,
  props: Readonly<Record<string, string>>,
) => Promise<string>;

/** Renders each widget through the built package inside the `edge-runtime` VM. */
export function describeEdgeRender(render: EdgeRender): void {
  describe("the SDK in the edge runtime", () => {
    it("renders the login widget as its custom element with its attributes", async () => {
      const html = await render("login", { projectId: "p1", proxyPath: "/px" });
      expect(html).toContain("<zitadel-login ");
      expect(html).toContain('project-id="p1"');
      expect(html).toContain('proxy-path="/px"');
    });

    it("renders the session widget as its custom element with its attributes", async () => {
      const html = await render("session", { projectId: "p1", proxyPath: "/px" });
      expect(html).toContain("<zitadel-session ");
      expect(html).toContain('project-id="p1"');
      expect(html).toContain('proxy-path="/px"');
    });

    it("renders the logout widget as its custom element with its attributes", async () => {
      const html = await render("logout", { projectId: "p1", proxyPath: "/px" });
      expect(html).toContain("<zitadel-logout ");
      expect(html).toContain('project-id="p1"');
      expect(html).toContain('proxy-path="/px"');
    });

    it("writes the purpose and the resumed flow into the login markup", async () => {
      const html = await render("login", {
        projectId: "p1",
        proxyPath: "/px",
        purpose: "register",
        resumeFlowId: "flow_123",
      });
      expect(html).toContain('purpose="register"');
      expect(html).toContain('resume-flow-id="flow_123"');
    });

    it("omits the language when none is set", async () => {
      const html = await render("login", { projectId: "p1", proxyPath: "/px" });
      expect(html).not.toContain("lang=");
    });
  });
}
