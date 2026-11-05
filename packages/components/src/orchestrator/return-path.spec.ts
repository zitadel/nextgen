import { afterEach, describe, expect, it } from "vitest";

import { returnPathFromLocation, safeReturnPath } from "./return-path.js";

const PAGE = "https://app.example.com/login?next=%2Fdashboard";

describe("safeReturnPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/", "/"],
    ["/admin/users?tab=roles#top", "/admin/users?tab=roles#top"],
    ["/a/../dashboard", "/dashboard"],
    ["/%2F%2Fevil.example", "/%2F%2Fevil.example"],
  ])("returns %j as %j", (value, path) => {
    expect(safeReturnPath(value, PAGE)).toBe(path);
  });

  it.each([
    ["nothing", null],
    ["an empty value", ""],
    ["a relative path", "dashboard"],
    ["a protocol-relative URL", "//evil.example"],
    ["a protocol-relative URL with a path", "//evil.example/dashboard"],
    ["an absolute URL on another origin", "https://evil.example/dashboard"],
    ["an absolute URL on the same origin", "https://app.example.com/dashboard"],
    ["a javascript: URL", "javascript:alert(document.domain)"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
    ["a backslash after the slash", "/\\evil.example"],
    ["a leading backslash", "\\\\evil.example"],
    ["a backslash further in", "/dashboard\\..\\..\\evil"],
    ["a tab between the slashes", "/\t/evil.example"],
    ["a newline between the slashes", "/\n/evil.example"],
    ["a carriage return", "/\r/evil.example"],
    ["a NUL", "/dashboard\u0000"],
    ["a DEL", "/dashboard\u007f"],
    ["a leading space", " /dashboard"],
    ["a dot segment that collapses to two slashes", "/.//evil.example"],
    ["an encoded dot segment that collapses to two slashes", "/%2e//evil.example"],
    ["a parent segment that collapses to two slashes", "/a/..//evil.example"],
  ])("refuses %s", (_, value) => {
    expect(safeReturnPath(value, PAGE)).toBeUndefined();
  });
});

describe("returnPathFromLocation", () => {
  afterEach(() => {
    history.replaceState(null, "", "/");
  });

  it("reads the page's next query parameter", () => {
    history.replaceState(null, "", "/login?next=%2Fdashboard%3Ftab%3Droles");

    expect(returnPathFromLocation()).toBe("/dashboard?tab=roles");
  });

  it("refuses a next parameter that names another host", () => {
    history.replaceState(null, "", "/login?next=%2F%2Fevil.example");

    expect(returnPathFromLocation()).toBeUndefined();
  });

  it("is undefined when the page has no next parameter", () => {
    history.replaceState(null, "", "/login?flow=flow_123");

    expect(returnPathFromLocation()).toBeUndefined();
  });
});
