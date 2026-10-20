import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The npm package as a consumer loads it. This project runs the source with
 * open roots, so a closed root here can only come from the build: the proof
 * that the published `dist` ships closed. `components:test` runs after the
 * build, as `standalone-artifact.spec.ts` relies on too.
 *
 * Nothing from the source is imported, because the built entry registers the
 * same tags and a tag registers once per page.
 */
const BUILT_ENTRY = "/dist/index.mjs";
const ORCHESTRATOR_TAGS = ["zitadel-login", "zitadel-session", "zitadel-logout"];
const LIGHT_DOM_TAGS = ["zl-passkey"];

function tagsOf(manifests: unknown): string[] {
  if (!Array.isArray(manifests)) throw new Error("the built package exports no manifestRegistry");
  return manifests.map((manifest: { tag: string }) => manifest.tag);
}

const built: unknown = await import(/* @vite-ignore */ BUILT_ENTRY);
const manifests =
  typeof built === "object" && built !== null ? Reflect.get(built, "manifestRegistry") : [];
const TAGS = [...tagsOf(manifests), ...ORCHESTRATOR_TAGS].filter(
  (tag) => !LIGHT_DOM_TAGS.includes(tag),
);

describe("the built package", () => {
  let host: HTMLDivElement;
  let modes: ShadowRootMode[];
  const attachShadow = Element.prototype.attachShadow;

  beforeEach(() => {
    _resetConfigForTesting();
    configureZitadel({
      proxyPath: "/__nextgen",
      projectId: "test-project",
      url: "http://localhost:4000",
    });
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    modes = [];
    Element.prototype.attachShadow = function (init: ShadowRootInit): ShadowRoot {
      modes.push(init.mode);
      return attachShadow.call(this, init);
    };
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    Element.prototype.attachShadow = attachShadow;
    vi.unstubAllGlobals();
    host.remove();
  });

  it("registers every tag it ships", () => {
    expect(TAGS.length).toBeGreaterThan(ORCHESTRATOR_TAGS.length);
    for (const tag of TAGS) expect(customElements.get(tag), tag).toBeDefined();
  });

  it.each(TAGS)("<%s> attaches a closed shadow root", (tag) => {
    const element = document.createElement(tag);
    host.appendChild(element);
    expect(modes).toEqual(["closed"]);
    expect(element.shadowRoot).toBeNull();
  });
});
