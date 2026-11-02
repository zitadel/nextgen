import { describe, expect, it } from "vitest";

import { shellArg, shellOption, withoutOptions } from "../../../src/lib/shell";

describe("shellArg", () => {
  it("returns a shell-safe value as it is", () => {
    expect(shellArg("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("quotes a value carrying shell metacharacters", () => {
    expect(shellArg("$(whoami)")).toBe("'$(whoami)'");
  });

  it("escapes an embedded single quote", () => {
    expect(shellArg("it's")).toBe(`'it'\\''s'`);
  });
});

describe("shellOption", () => {
  it("separates an ordinary value from its option", () => {
    expect(shellOption("--cwd", "/home/dev/app")).toBe("--cwd /home/dev/app");
  });

  it("joins a dash-prefixed value with `=`, which no parser reads as another option", () => {
    expect(shellOption("--cwd", "--force")).toBe("--cwd=--force");
  });

  it("quotes a dash-prefixed value that also needs quoting, keeping the `=`", () => {
    expect(shellOption("--cwd", "--my dir")).toBe("--cwd='--my dir'");
  });

  it("quotes an ordinary value that needs it", () => {
    expect(shellOption("--env-file", "my env.local")).toBe("--env-file 'my env.local'");
  });
});

describe("withoutOptions", () => {
  it("drops an option and its value", () => {
    expect(withoutOptions(["rm", "FOO", "--cwd", "app", "--preview"], ["--cwd"])).toEqual([
      "rm",
      "FOO",
      "--preview",
    ]);
  });

  it("drops an option written with =", () => {
    expect(withoutOptions(["rm", "--server=https://x", "FOO"], ["--server"])).toEqual([
      "rm",
      "FOO",
    ]);
  });

  it("drops a short option and its value", () => {
    expect(withoutOptions(["rm", "-c", "app", "FOO"], ["-c"])).toEqual(["rm", "FOO"]);
  });

  it("keeps an option it was not asked to drop", () => {
    expect(withoutOptions(["rm", "--env", "prod"], ["--cwd"])).toEqual(["rm", "--env", "prod"]);
  });
});
