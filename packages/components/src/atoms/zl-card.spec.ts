import { describe, expect, it } from "vitest";

import "./zl-card.js";
import type { ZlCard } from "./zl-card.js";

describe("zl-card", () => {
  it("does not hide a slotted title before the first slot sync", async () => {
    const el = document.createElement("zl-card") as ZlCard;
    el.innerHTML = `<h1 slot="header" class="zl-card-title">Sign in</h1>`;
    document.body.append(el);
    await el.updateComplete;

    const header = el.shadowRoot?.querySelector(".zr-card__header");
    expect(header?.classList.contains("zr-card__region--empty")).toBe(false);
    expect(el.querySelector(".zl-card-title")?.textContent).toBe("Sign in");
  });

  it("hides empty footer so card height matches React Card (no extra flex gap)", async () => {
    const el = document.createElement("zl-card") as ZlCard;
    el.innerHTML = `
      <h1 slot="header" class="zl-card-title">Sign in</h1>
      <div class="card-demo-stack" aria-hidden="true"><div></div></div>
    `;
    document.body.append(el);
    await el.updateComplete;

    const footer = el.shadowRoot?.querySelector(".zr-card__footer");
    expect(footer?.classList.contains("zr-card__region--empty")).toBe(true);
    expect(footer?.getBoundingClientRect().height).toBe(0);
  });
});
