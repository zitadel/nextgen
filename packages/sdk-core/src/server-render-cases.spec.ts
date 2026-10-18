import { describe, expect, it } from "vitest";

import { widgetAttributes } from "./attributes.js";
import { SERVER_RENDER_CASES } from "./server-render-cases.js";

describe("SERVER_RENDER_CASES", () => {
  it("has a unique title per case", () => {
    const titles = SERVER_RENDER_CASES.map((c) => c.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it.each(SERVER_RENDER_CASES)("matches widgetAttributes: $title", (c) => {
    const attributes = widgetAttributes(c.widget, c.props as never);
    expect(attributes).toMatchObject(c.present);
    for (const name of c.absent) expect(attributes).not.toHaveProperty(name);
  });
});
