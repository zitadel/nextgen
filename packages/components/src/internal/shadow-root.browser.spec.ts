import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIGHT_DOM_TAGS, registeredElements } from "../__tests__/registered-elements.js";

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

const elements = await registeredElements(() => import(/* @vite-ignore */ BUILT_ENTRY));

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

  it("registers the atoms and the three orchestrators", () => {
    const tags = elements.map(({ tag }) => tag);
    expect(tags).toEqual(expect.arrayContaining(["zl-field", "zitadel-login", "zitadel-logout"]));
    expect(elements.length).toBeGreaterThanOrEqual(14);
  });

  it.each(elements)(
    "<$tag> attaches a closed shadow root, or none if it is light DOM",
    ({ tag }) => {
      const element = document.createElement(tag);
      host.appendChild(element);
      expect(modes).toEqual(LIGHT_DOM_TAGS.includes(tag) ? [] : ["closed"]);
      expect(element.shadowRoot).toBeNull();
    },
  );
});
