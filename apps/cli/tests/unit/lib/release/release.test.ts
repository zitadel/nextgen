import { describe, expect, it } from "vitest";

import { abbreviate } from "../../../../src/lib/release/release";

describe("abbreviate", () => {
  // `Deployed sha256:<64 hex>` is wider than a closing line may be, so the
  // whole sentence was thrown away and replaced by "Done".
  it("cuts a content hash to a closing line a person can read", () => {
    expect(abbreviate(`sha256:${"a".repeat(64)}`)).toBe("sha256:aaaaaaaaaaaa");
  });

  it("keeps the algorithm, so what was cut is still named", () => {
    expect(abbreviate(`sha256:${"0123456789abcdef".repeat(4)}`)).toBe("sha256:0123456789ab");
  });

  it("leaves a hash short enough to read as it is", () => {
    expect(abbreviate("sha256:abc")).toBe("sha256:abc");
  });

  it("cuts a bare digest that names no algorithm", () => {
    expect(abbreviate("a".repeat(64))).toBe("aaaaaaaaaaaa");
  });
});
