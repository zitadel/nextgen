import { widgetNames, widgetTags } from "@zitadel/sdk-core/types";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { businessLocales, ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";

const widgets = { login: ZitadelLogin, logout: ZitadelLogout, session: ZitadelSession };

/**
 * Loads the wrapper inside the `edge-runtime` VM (the `edge` project in
 * `vitest.config.ts`), which has no `HTMLElement`, `document` or
 * `customElements`, with dependencies resolved the way a bundler resolves them
 * for the edge. The wrapper fails to load there if it imports an element class
 * from `@zitadel/components`, whose edge entry has none.
 */
describe("the wrapper in the edge runtime", () => {
  it("runs without a DOM", () => {
    expect(typeof HTMLElement).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof customElements).toBe("undefined");
  });

  it("loads and keeps the locale data it re-exports", () => {
    expect(Object.keys(businessLocales).length).toBeGreaterThan(0);
  });

  it.each(widgetNames)("renders the %s widget by its tag name", (name) => {
    const Widget = widgets[name];
    expect(renderToString(<Widget projectId="p1" proxyPath="/px" />)).toContain(
      `<${widgetTags[name]} `,
    );
  });

  it("writes the project coordinates and the purpose into the login markup", () => {
    const html = renderToString(
      <ZitadelLogin projectId="p1" proxyPath="/px" purpose="register" resumeFlowId="flow_123" />,
    );
    expect(html).toContain('project-id="p1"');
    expect(html).toContain('proxy-path="/px"');
    expect(html).toContain('purpose="register"');
    expect(html).toContain('resume-flow-id="flow_123"');
  });

  it("leaves the properties and the callbacks out of the markup", () => {
    const html = renderToString(
      <ZitadelLogin
        project={{ projectId: "p1", proxyPath: "/px" }}
        variant="page"
        locales={{ en: {} }}
        onFlowStep={() => undefined}
      />,
    );
    expect(html).not.toMatch(/variant|locales|onFlowStep|object Object/i);
  });
});
