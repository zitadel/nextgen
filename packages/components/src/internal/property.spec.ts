import { LitElement } from "lit";
import { describe, expect, it } from "vitest";

import { property } from "./property.js";

class Probe extends LitElement {
  @property({ type: String }) accessor text = "default";
  @property({ type: Boolean }) accessor flag = false;
  @property({ attribute: false }) accessor handle: object | undefined;
  @property({ type: String }) accessor empty: string | null = null;
}
customElements.define("probe-property", Probe);

describe("property", () => {
  it("restores the default when undefined or null is assigned", () => {
    const probe = new Probe();
    probe.text = "set";
    probe.text = undefined as unknown as string;
    expect(probe.text).toBe("default");
    probe.text = "set";
    probe.text = null as unknown as string;
    expect(probe.text).toBe("default");
  });

  it("restores the default when the attribute is removed", () => {
    const probe = new Probe();
    probe.setAttribute("text", "set");
    probe.removeAttribute("text");
    expect(probe.text).toBe("default");
  });

  it("keeps a supplied value, including an empty string and false", () => {
    const probe = new Probe();
    probe.text = "";
    probe.flag = true;
    expect(probe.text).toBe("");
    probe.flag = false;
    expect(probe.flag).toBe(false);
  });

  it("leaves a property whose default is undefined or null as assigned", () => {
    const probe = new Probe();
    const handle = {};
    probe.handle = handle;
    probe.handle = undefined;
    expect(probe.handle).toBeUndefined();
    probe.empty = "set";
    probe.empty = null;
    expect(probe.empty).toBeNull();
  });

  it("still updates the element when a value is cleared", async () => {
    const probe = new Probe();
    document.body.append(probe);
    await probe.updateComplete;
    probe.text = "set";
    await probe.updateComplete;
    probe.text = undefined as unknown as string;
    await probe.updateComplete;
    expect(probe.text).toBe("default");
    probe.remove();
  });

  it("keeps each instance's own default", () => {
    const first = new Probe();
    const second = new Probe();
    first.text = "set";
    second.text = undefined as unknown as string;
    expect(second.text).toBe("default");
    expect(first.text).toBe("set");
  });
});
