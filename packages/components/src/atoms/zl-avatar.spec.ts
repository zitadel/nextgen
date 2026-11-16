import { describe, expect } from "vitest";

import { avatarVars } from "../avatar.js";
import "./zl-avatar.js";
import type { ZlAvatar } from "./zl-avatar.js";
import { it, type Render } from "../test/fixtures.js";

/** Markup contract for `<zl-avatar>`: a decorative circle painted from `seed`. */
describe("<zl-avatar>", () => {
  async function mount(render: Render, markup: string): Promise<HTMLElement> {
    const element = await render<ZlAvatar>(markup);
    return element.shadowRoot?.querySelector<HTMLElement>(".zl-avatar") as HTMLElement;
  }

  it("paints the seed's colours, as the console does", async ({ render }) => {
    const avatar = await mount(render, `<zl-avatar seed="Maya@Example.com"></zl-avatar>`);
    for (const [name, value] of Object.entries(avatarVars("maya@example.com"))) {
      expect(avatar.style.getPropertyValue(name)).toBe(value);
    }
  });

  it("is hidden from assistive technology", async ({ render }) => {
    const avatar = await mount(render, `<zl-avatar seed="maya@example.com"></zl-avatar>`);
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
    expect(avatar.getAttribute("part")).toBe("avatar");
  });
});
