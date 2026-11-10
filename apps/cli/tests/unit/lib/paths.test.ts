import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ancestors, MANAGED_MARKER, resolveCwd } from "@/lib/paths";

describe("resolveCwd", () => {
  it("returns process.cwd() when no argument is given", () => {
    expect(resolveCwd()).toBe(process.cwd());
  });

  it("returns process.cwd() when given undefined", () => {
    expect(resolveCwd(undefined)).toBe(process.cwd());
  });

  it("resolves a relative path against process.cwd()", () => {
    expect(resolveCwd("sub/dir")).toBe(resolve(process.cwd(), "sub/dir"));
  });

  it("passes an absolute path through (normalised)", () => {
    expect(resolveCwd("/tmp/example")).toBe(resolve("/tmp/example"));
    expect(resolveCwd("/tmp/example")).toBe("/tmp/example");
  });
});

describe("MANAGED_MARKER", () => {
  it("is the versioned managed-file sentinel comment", () => {
    expect(MANAGED_MARKER).toBe("// zitadel-cli: managed-file v1");
  });
});

describe("ancestors", () => {
  it("lists the path and each directory above it, nearest first, up to the root", () => {
    expect(ancestors("/a/b/c")).toEqual(["/a/b/c", "/a/b", "/a", "/"]);
  });

  it("ends at the stop directory, which it includes", () => {
    expect(ancestors("/a/b/c", "/a/b")).toEqual(["/a/b/c", "/a/b"]);
  });

  it("is just the root for the root", () => {
    expect(ancestors("/")).toEqual(["/"]);
  });
});
