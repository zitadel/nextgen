import { describe, expect, it } from "vitest";

import { Report } from "@/lib/orca/patchers/rule/file-writer/report";

describe("Report", () => {
  it("starts with nothing done", () => {
    expect(Report.empty().toResult(false)).toEqual({
      dryRun: false,
      files: [],
      filesWritten: [],
      filesSkipped: [],
      depsAdded: [],
    });
  });

  it("records an artifact once, with the first action as the net one", () => {
    const report = Report.empty()
      .with({ path: "/a/.env", kind: "file", action: "create" })
      .with({ path: "/a/.env", kind: "file", action: "update" });

    expect(report.files).toEqual([{ path: "/a/.env", kind: "file", action: "create" }]);
  });

  it("reports a path both written and later skipped as written only", () => {
    const report = Report.empty()
      .with({ path: "/a/x", kind: "file", action: "update" })
      .with({ path: "/a/x", kind: "file", action: "skip" })
      .with({ path: "/a/y", kind: "file", action: "skip" });

    expect(report.toResult(false).filesSkipped).toEqual(["/a/y"]);
  });

  it("keeps directories in the rows and out of the flat written list", () => {
    const result = Report.empty()
      .with({ path: "/a/d", kind: "dir", action: "create" })
      .with({ path: "/a/f", kind: "file", action: "create" })
      .toResult(false);

    expect(result.files.map((file) => file.kind)).toEqual(["dir", "file"]);
    expect(result.filesWritten).toEqual(["/a/f"]);
  });

  it("collects every dependency an outcome adds, in order", () => {
    const report = Report.empty()
      .with({ path: "/a/package.json", kind: "file", action: "update", dependency: "b" })
      .with({ path: "/a/package.json", kind: "file", action: "update", dependency: "a" });

    expect(report.toResult(true).depsAdded).toEqual(["b", "a"]);
  });

  it("answers a new report and leaves the old one as it was", () => {
    const before = Report.empty();
    const after = before.with({ path: "/a/x", kind: "file", action: "create" });

    expect(before.files).toEqual([]);
    expect(after.files).toHaveLength(1);
  });

  it("freezes every list it hands out", () => {
    const result = Report.empty()
      .with({ path: "/a/x", kind: "file", action: "create", dependency: "d" })
      .with({ path: "/a/y", kind: "file", action: "skip" })
      .toResult(false);

    expect(
      [result.files, result.filesWritten, result.filesSkipped, result.depsAdded].map((list) =>
        Object.isFrozen(list),
      ),
    ).toEqual([true, true, true, true]);
  });
});
