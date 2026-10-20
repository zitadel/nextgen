import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { FORCE_OPEN_SHADOW_ROOTS, openShadowRoots } from "../../src/shadow-roots";

interface AttachInit {
  mode: string;
  delegatesFocus?: boolean;
}

class FakeElement {
  attachShadow(init: AttachInit): AttachInit {
    return init;
  }
}

describe("FORCE_OPEN_SHADOW_ROOTS", () => {
  it("attaches a closed request open and keeps the rest of the options", () => {
    runInNewContext(FORCE_OPEN_SHADOW_ROOTS, { Element: FakeElement });

    expect(new FakeElement().attachShadow({ mode: "closed", delegatesFocus: true })).toEqual({
      mode: "open",
      delegatesFocus: true,
    });
  });

  it("leaves an open request open", () => {
    runInNewContext(FORCE_OPEN_SHADOW_ROOTS, { Element: FakeElement });

    expect(new FakeElement().attachShadow({ mode: "open" })).toEqual({ mode: "open" });
  });
});

describe("openShadowRoots", () => {
  it("registers the script to run before the page's own", async () => {
    const scripts: { content: string }[] = [];

    await openShadowRoots({
      addInitScript: async (script) => {
        scripts.push(script);
      },
    });

    expect(scripts).toEqual([{ content: FORCE_OPEN_SHADOW_ROOTS }]);
  });
});
