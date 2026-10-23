import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { avatarVars } from "../avatar.js";
import "./zl-avatar.js";
import type { ZlAvatar } from "./zl-avatar.js";

/** Markup contract for `<zl-avatar>`: a decorative circle painted from `seed`. */
describe("<zl-avatar>", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  async function mount(markup: string): Promise<HTMLElement> {
    host.innerHTML = markup;
    const element = host.querySelector("zl-avatar") as ZlAvatar;
    await element.updateComplete;
    return element.shadowRoot?.querySelector<HTMLElement>(".zl-avatar") as HTMLElement;
  }

  it("paints the seed's colours, as the console does", async () => {
    const avatar = await mount(`<zl-avatar seed="Maya@Example.com"></zl-avatar>`);
    for (const [name, value] of Object.entries(avatarVars("maya@example.com"))) {
      expect(avatar.style.getPropertyValue(name)).toBe(value);
    }
  });

  it("is hidden from assistive technology", async () => {
    const avatar = await mount(`<zl-avatar seed="maya@example.com"></zl-avatar>`);
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
    expect(avatar.getAttribute("part")).toBe("avatar");
  });
});
