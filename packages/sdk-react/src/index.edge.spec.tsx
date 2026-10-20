import type { ComponentType } from "react";

import { ZitadelLogin, ZitadelLogout, ZitadelSession, businessLocales } from "@zitadel/sdk-react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

const render = async <Props extends object>(
  component: ComponentType<Props>,
  props: Props,
): Promise<string> => renderToString(createElement(component, props));

// edge-entry:begin
/**
 * Loads the built package, as a consumer's bundler resolves it, inside the
 * `edge-runtime` VM (the `edge` project in `vitest.config.ts`), which has no
 * `HTMLElement`, `document` or `customElements`, with dependencies resolved the
 * way a bundler resolves them for the edge.
 */
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
// edge-entry:end

// edge-render:begin
describe("the SDK in the edge runtime", () => {
  it("renders the login widget as its custom element with its attributes", async () => {
    const html = await render(ZitadelLogin, { projectId: "p1", proxyPath: "/px" });
    expect(html).toContain("<zitadel-login ");
    expect(html).toContain('project-id="p1"');
    expect(html).toContain('proxy-path="/px"');
  });

  it("renders the session widget as its custom element with its attributes", async () => {
    const html = await render(ZitadelSession, { projectId: "p1", proxyPath: "/px" });
    expect(html).toContain("<zitadel-session ");
    expect(html).toContain('project-id="p1"');
    expect(html).toContain('proxy-path="/px"');
  });

  it("renders the logout widget as its custom element with its attributes", async () => {
    const html = await render(ZitadelLogout, { projectId: "p1", proxyPath: "/px" });
    expect(html).toContain("<zitadel-logout ");
    expect(html).toContain('project-id="p1"');
    expect(html).toContain('proxy-path="/px"');
  });

  it("writes the purpose and the resumed flow into the login markup", async () => {
    const html = await render(ZitadelLogin, {
      projectId: "p1",
      proxyPath: "/px",
      purpose: "register",
      resumeFlowId: "flow_123",
    });
    expect(html).toContain('purpose="register"');
    expect(html).toContain('resume-flow-id="flow_123"');
  });

  it("omits the language when none is set", async () => {
    const html = await render(ZitadelLogin, { projectId: "p1", proxyPath: "/px" });
    expect(html).not.toContain("lang=");
  });
});
// edge-render:end
