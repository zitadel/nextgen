import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";

import { businessLocales, ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";

/**
 * Loads the SDK entry and server-renders its widgets inside the `edge-runtime`
 * VM (the `edge` project in `vitest.config.ts`), which has no DOM. The widgets
 * render as bare custom elements, and the entry reaches `@zitadel/components`
 * only through its Lit-free edge build.
 */
const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

describe("sdk-vue entry in the edge runtime", () => {
  it("runs without a DOM", () => {
    expect(typeof HTMLElement).toBe("undefined");
  });

  it("keeps the locale data it re-exports", () => {
    expect(Object.keys(businessLocales).length).toBeGreaterThan(0);
  });

  it.each([
    ["ZitadelLogin", ZitadelLogin, "<zitadel-login"],
    ["ZitadelLogout", ZitadelLogout, "<zitadel-logout"],
    ["ZitadelSession", ZitadelSession, "<zitadel-session"],
  ])("server-renders %s as a custom element", async (_name, component, tag) => {
    const html = await renderToString(createSSRApp({ render: () => h(component, project) }));
    expect(html).toContain(tag);
  });
});
