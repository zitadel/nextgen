import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { entryName, namedEntries, posixPath, resolvedEntries } from "./entries.ts";

describe("entryName", () => {
  it("drops the directory and the extension", () => {
    expect(entryName("./src/lib/index.server.ts")).toBe("index.server");
  });
});

describe("namedEntries", () => {
  it("names listed files after their file name", () => {
    expect(namedEntries(["src/a.ts", "src/b/c.tsx"])).toEqual({ a: "src/a.ts", c: "src/b/c.tsx" });
  });

  it("refuses two listed files with the same name instead of dropping one", () => {
    expect(() => namedEntries(["src/a/index.ts", "src/b/index.ts"])).toThrow(
      /src\/a\/index\.ts and src\/b\/index\.ts are both named "index"/,
    );
  });

  it("keeps the names of a map", () => {
    expect(namedEntries({ "runtime/plugin": "src/runtime/plugin.ts" })).toEqual({
      "runtime/plugin": "src/runtime/plugin.ts",
    });
  });
});

describe("posixPath", () => {
  it("spells a Windows path the way Vite spells module ids", () => {
    expect(posixPath("C:\\pkg\\src\\index.ts")).toBe("C:/pkg/src/index.ts");
  });
});

describe("resolvedEntries", () => {
  it("resolves every file against the root", () => {
    expect(resolvedEntries({ index: "src/index.ts" }, "/pkg")).toEqual({
      index: join("/pkg", "src/index.ts"),
    });
  });
});
