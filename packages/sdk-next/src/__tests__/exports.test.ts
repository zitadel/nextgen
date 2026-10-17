import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import * as root from "../index";
import { getSession } from "../session";

describe("package exports", () => {
  it("keeps browser-only getSession on the dedicated session subpath", () => {
    expect("getSession" in root).toBe(false);
    expect(typeof getSession).toBe("function");
  });
});

describe("package manifest", () => {
  // Next 15.0.0 to 15.2.2 skip middleware for a request that sends
  // `x-middleware-subrequest` (CVE-2025-29927), which bypasses protectedRoutes.
  it("requires a Next.js release that runs middleware for every request", () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as {
      peerDependencies: Record<string, string>;
    };

    expect(manifest.peerDependencies.next).toBe(">=15.2.3");
  });
});
