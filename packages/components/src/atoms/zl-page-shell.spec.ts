import { describe, expect, it } from "vitest";

import "./zl-page-shell.js";
import type { ZlPageShell } from "./zl-page-shell.js";

describe("zl-page-shell", () => {
  it("hides empty footer so shell height does not reserve footer gap", async () => {
    const el = document.createElement("zl-page-shell") as ZlPageShell;
    el.innerHTML = `
      <zl-card>
        <h1 slot="header">Sign in</h1>
      </zl-card>
    `;
    document.body.append(el);
    await el.updateComplete;

    const footer = el.shadowRoot?.querySelector(".zr-page-shell__footer");
    expect(footer?.classList.contains("zr-page-shell__region--empty")).toBe(true);
    expect(footer?.getBoundingClientRect().height).toBe(0);
  });
});
