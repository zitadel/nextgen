import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zl-account.js";
import type { ZlAccount } from "./zl-account.js";

/**
 * Markup contract for `<zl-account>`: a static chip without an action, one
 * link running it with one, and the avatar only when the template asks.
 */
describe("<zl-account>", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  async function mount(markup: string): Promise<ZlAccount> {
    host.innerHTML = markup;
    const element = host.querySelector("zl-account") as ZlAccount;
    await element.updateComplete;
    return element;
  }

  it("names the account without a control when it has no action", async () => {
    const element = await mount(`<zl-account identifier="maya@example.com"></zl-account>`);
    const root = element.shadowRoot;
    expect(root?.querySelector("a")).toBeNull();
    expect(root?.querySelector(".zr-account__value")?.textContent).toBe("maya@example.com");
    expect(root?.querySelector("zl-icon")).toBeNull();
  });

  it("makes the whole chip one link, named by the account and what it does", async () => {
    const element = await mount(
      `<zl-account identifier="maya@example.com" action="back" label="Use another account"></zl-account>`,
    );
    const link = element.shadowRoot?.querySelector("a");
    expect(link?.getAttribute("aria-label")).toBe("maya@example.com, Use another account");
    expect(link?.getAttribute("title")).toBe("Use another account");
    expect(link?.querySelector('zl-icon[name="arrow-left-right"]')).not.toBeNull();
  });

  it("runs its action when activated", async () => {
    const element = await mount(
      `<zl-account identifier="maya@example.com" action="back" label="Use another account"></zl-account>`,
    );
    const submitted = vi.fn();
    host.addEventListener("zl-submit", (event) => submitted(event.detail));

    element.shadowRoot?.querySelector("a")?.click();

    expect(submitted).toHaveBeenCalledWith({ action: "back" });
  });

  it("shows the avatar from the identifier only when asked", async () => {
    const without = await mount(`<zl-account identifier="maya@example.com"></zl-account>`);
    expect(without.shadowRoot?.querySelector("zl-avatar")).toBeNull();

    const withAvatar = await mount(
      `<zl-account identifier="Maya@Example.com" avatar></zl-account>`,
    );
    expect(withAvatar.shadowRoot?.querySelector("zl-avatar")?.getAttribute("seed")).toBe(
      "Maya@Example.com",
    );
  });
});
