import { describe, expect, it } from "vitest";

import { isErrno } from "@/lib/errno";

describe("isErrno", () => {
  it("recognises the errno code it is asked about", () => {
    expect(isErrno(Object.assign(new Error("gone"), { code: "ENOENT" }), "ENOENT")).toBe(true);
  });

  it("is false for another code, an error without one, and anything that is not an object", () => {
    expect(isErrno(Object.assign(new Error("gone"), { code: "EACCES" }), "ENOENT")).toBe(false);
    expect(isErrno(new Error("no code"), "ENOENT")).toBe(false);
    expect(isErrno(undefined, "ENOENT")).toBe(false);
    expect(isErrno(null, "ENOENT")).toBe(false);
    expect(isErrno("ENOENT", "ENOENT")).toBe(false);
  });
});
