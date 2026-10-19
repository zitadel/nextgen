import { describe, expect, it } from "vitest";

import { forwardHostAttributes } from "./host-attributes";

const pair = (): { host: HTMLElement; target: HTMLElement } => ({
  host: document.createElement("zitadel-auth-login"),
  target: document.createElement("zitadel-login"),
});

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("forwardHostAttributes", () => {
  it("moves the attributes the page must hold once", () => {
    const { host, target } = pair();
    host.setAttribute("id", "probe");
    host.setAttribute("data-testid", "probe");
    host.setAttribute("aria-label", "probe");
    host.setAttribute("role", "region");
    host.setAttribute("tabindex", "3");
    forwardHostAttributes(host, target);
    expect(target.getAttribute("id")).toBe("probe");
    expect(target.getAttribute("data-testid")).toBe("probe");
    expect(target.getAttribute("aria-label")).toBe("probe");
    expect(target.getAttribute("role")).toBe("region");
    expect(target.getAttribute("tabindex")).toBe("3");
    expect(host.hasAttribute("id")).toBe(false);
    expect(host.hasAttribute("data-testid")).toBe(false);
  });

  it("mirrors class, style and slot, and the host keeps them", () => {
    const { host, target } = pair();
    host.setAttribute("class", "a b");
    host.setAttribute("style", "color: red");
    host.setAttribute("slot", "probe");
    forwardHostAttributes(host, target);
    expect(target.className).toBe("a b");
    expect(target.style.color).toBe("red");
    expect(target.getAttribute("slot")).toBe("probe");
    expect(host.className).toBe("a b");
    expect(host.getAttribute("slot")).toBe("probe");
  });

  it("leaves the widget input attributes where they are", () => {
    const { host, target } = pair();
    host.setAttribute("lang", "de");
    host.setAttribute("projectId", "proj-test");
    host.setAttribute("purpose", "login");
    forwardHostAttributes(host, target);
    expect(target.hasAttribute("lang")).toBe(false);
    expect(target.hasAttribute("projectid")).toBe(false);
    expect(target.hasAttribute("purpose")).toBe(false);
  });

  it("keeps the classes and styles the widget element sets itself", async () => {
    const { host, target } = pair();
    target.classList.add("own");
    target.style.setProperty("margin", "1px");
    host.classList.add("a");
    host.style.setProperty("color", "red");
    forwardHostAttributes(host, target);
    host.classList.remove("a");
    host.style.removeProperty("color");
    await nextTask();
    expect(target.className).toBe("own");
    expect(target.style.color).toBe("");
    expect(target.style.margin).toBe("1px");
  });

  it("follows a binding that changes an attribute later", async () => {
    const { host, target } = pair();
    forwardHostAttributes(host, target);
    host.setAttribute("aria-label", "first");
    host.classList.add("on");
    await nextTask();
    expect(target.getAttribute("aria-label")).toBe("first");
    expect(target.classList.contains("on")).toBe(true);
    host.setAttribute("aria-label", "second");
    host.classList.remove("on");
    await nextTask();
    expect(target.getAttribute("aria-label")).toBe("second");
    expect(target.classList.contains("on")).toBe(false);
  });

  it("stops following once it is stopped", async () => {
    const { host, target } = pair();
    const stop = forwardHostAttributes(host, target);
    stop();
    host.setAttribute("id", "late");
    await nextTask();
    expect(target.hasAttribute("id")).toBe(false);
  });
});
