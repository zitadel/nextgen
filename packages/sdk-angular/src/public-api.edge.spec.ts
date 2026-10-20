import type { ComponentRef, Type } from "@angular/core";

import { DOCUMENT } from "@angular/common";
import { createComponent } from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import { provideServerRendering, renderApplication } from "@angular/platform-server";
import {
  businessLocales,
  ZitadelLoginComponent,
  ZitadelLogoutComponent,
  ZitadelSessionComponent,
} from "@zitadel/sdk-angular";
import { type WidgetName, widgetNames, widgetTags } from "@zitadel/sdk-core/types";
import { describe, expect, it } from "vitest";

const components = {
  login: ZitadelLoginComponent,
  logout: ZitadelLogoutComponent,
  session: ZitadelSessionComponent,
};

/** Server-renders `component` with `inputs` set, with the real Angular server renderer. */
async function serverRender(
  component: Type<unknown>,
  inputs: Record<string, unknown>,
): Promise<string> {
  return renderApplication(
    async (context) => {
      const app = await createApplication({ providers: [provideServerRendering()] }, context);
      const document = app.injector.get(DOCUMENT);
      const host = document.createElement("div");
      document.body.appendChild(host);
      const ref: ComponentRef<unknown> = createComponent(component, {
        environmentInjector: app.injector,
        hostElement: host,
      });
      for (const [name, value] of Object.entries(inputs)) ref.setInput(name, value);
      app.attachView(ref.hostView);
      return app;
    },
    { document: "<!doctype html><html><head></head><body></body></html>" },
  );
}

/**
 * Loads the built package inside the `edge-runtime` VM (the `edge` project in
 * `vitest.config.ts`), which has no `HTMLElement`, `document` or
 * `customElements`, with dependencies resolved the way a bundler resolves them
 * for the edge and the partially compiled Angular code linked as the Angular
 * CLI links it, and renders its widgets to markup.
 */
type EdgeProps = {
  projectId: string;
  proxyPath: string;
  purpose?: "register";
  resumeFlowId?: string;
};

const renderWidget = async (name: WidgetName, props: EdgeProps): Promise<string> =>
  serverRender(components[name], props);

// edge-entry:begin
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
