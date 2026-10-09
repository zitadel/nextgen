import { describe, expect, it } from "vitest";

import * as root from "../index";
import { getSession } from "../session";

describe("package exports", () => {
  it("keeps browser-only getSession on the dedicated session subpath", () => {
    expect("getSession" in root).toBe(false);
    expect(typeof getSession).toBe("function");
  });
});
