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
import { widgetNames, widgetTags } from "@zitadel/sdk-core/types";
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
 * CLI links it. The package fails to load there if it imports an element class
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

  it.each(widgetNames)("renders the %s widget by its tag name", async (name) => {
    const html = await serverRender(components[name], { projectId: "p1", proxyPath: "/px" });
    expect(html).toContain(`<${widgetTags[name]} `);
  });

  it("writes the project coordinates and the purpose into the login markup", async () => {
    const html = await serverRender(ZitadelLoginComponent, {
      projectId: "p1",
      proxyPath: "/px",
      purpose: "register",
      resumeFlowId: "flow_123",
    });
    expect(html).toContain('project-id="p1"');
    expect(html).toContain('proxy-path="/px"');
    expect(html).toContain('purpose="register"');
    expect(html).toContain('resume-flow-id="flow_123"');
  });

  it("leaves the properties and the callbacks out of the markup", async () => {
    const html = await serverRender(ZitadelLoginComponent, {
      project: { projectId: "p1", proxyPath: "/px" },
      locales: { en: {} },
    });
    expect(html).not.toMatch(/locales|onFlowStep|object Object/i);
  });

  it("omits the language when none is set", async () => {
    expect(await serverRender(ZitadelLoginComponent, {})).not.toContain("lang=");
  });
});
