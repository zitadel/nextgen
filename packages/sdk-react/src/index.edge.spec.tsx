import { type WidgetName, widgetNames, widgetTags } from "@zitadel/sdk-core/types";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { businessLocales, ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";

/**
 * Loads the SDK entry inside the `edge-runtime` VM (the `edge` project in
 * `vitest.config.ts`), which has no `HTMLElement`, `document` or
 * `customElements`, with dependencies resolved the way a bundler resolves them
 * for the edge, and renders its widgets to markup.
 */
type EdgeProps = {
  projectId: string;
  proxyPath: string;
  purpose?: "register";
  resumeFlowId?: string;
};

const renderWidget = async (name: WidgetName, props: EdgeProps): Promise<string> => {
  if (name === "login") return renderToString(<ZitadelLogin {...props} />);
  const { projectId, proxyPath } = props;
  return renderToString(
    name === "logout" ? (
      <ZitadelLogout projectId={projectId} proxyPath={proxyPath} />
    ) : (
      <ZitadelSession projectId={projectId} proxyPath={proxyPath} />
    ),
  );
};

// edge-render:begin
describe("the SDK in the edge runtime", () => {
  it("runs without a DOM", () => {
    expect(typeof HTMLElement).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof customElements).toBe("undefined");
  });

  it("keeps the locale data it re-exports", () => {
    expect(Object.keys(businessLocales).length).toBeGreaterThan(0);
  });

  it.each(widgetNames)(
    "renders the %s widget as its custom element with its attributes",
    async (name) => {
      const html = await renderWidget(name, { projectId: "p1", proxyPath: "/px" });
      expect(html).toContain(`<${widgetTags[name]} `);
      expect(html).toContain('project-id="p1"');
      expect(html).toContain('proxy-path="/px"');
    },
  );

  it("writes the purpose and the resumed flow into the login markup", async () => {
    const html = await renderWidget("login", {
      projectId: "p1",
      proxyPath: "/px",
      purpose: "register",
      resumeFlowId: "flow_123",
    });
    expect(html).toContain('purpose="register"');
    expect(html).toContain('resume-flow-id="flow_123"');
  });

  it("omits the language when none is set", async () => {
    const html = await renderWidget("login", { projectId: "p1", proxyPath: "/px" });
    expect(html).not.toContain("lang=");
  });
});
// edge-render:end

describe("the React wrapper in the edge runtime", () => {
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
