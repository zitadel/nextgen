import { describe, expect, it } from "vitest";

import { Cmd } from "@/lib/cmd";

describe("Cmd.quote", () => {
  it("returns a shell-safe value as it is", () => {
    expect(Cmd.quote("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("quotes a value carrying shell metacharacters", () => {
    expect(Cmd.quote("$(whoami)")).toBe("'$(whoami)'");
  });

  it("escapes an embedded single quote", () => {
    expect(Cmd.quote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("Cmd.option", () => {
  it("separates an ordinary value from its option", () => {
    expect(Cmd.option("--cwd", "/home/dev/app")).toBe("--cwd /home/dev/app");
  });

  it("joins a dash-prefixed value with `=`, which no parser reads as another option", () => {
    expect(Cmd.option("--cwd", "--force")).toBe("--cwd=--force");
  });

  it("quotes a dash-prefixed value that also needs quoting, keeping the `=`", () => {
    expect(Cmd.option("--cwd", "--my dir")).toBe("--cwd='--my dir'");
  });

  it("quotes an ordinary value that needs it", () => {
    expect(Cmd.option("--env-file", "my env.local")).toBe("--env-file 'my env.local'");
  });
});

describe("Cmd#toString", () => {
  it("joins the words with single spaces", () => {
    expect(Cmd.of(["origin", "rm", "https://x.test"]).toString()).toBe("origin rm https://x.test");
  });

  it("quotes each word that needs it", () => {
    expect(Cmd.of(["origin", "add", "a b", "$(whoami)"]).toString()).toBe(
      "origin add 'a b' '$(whoami)'",
    );
  });

  it("is empty for a line with no words", () => {
    expect(Cmd.of([]).toString()).toBe("");
  });
});

describe("Cmd#without", () => {
  it("drops an option and its value", () => {
    const line = Cmd.of(["rm", "FOO", "--cwd", "app", "--preview"]).without(["--cwd"]);

    expect(line.toString()).toBe("rm FOO --preview");
  });

  it("drops an option written with =", () => {
    const line = Cmd.of(["rm", "--server=https://x", "FOO"]).without(["--server"]);

    expect(line.toString()).toBe("rm FOO");
  });

  it("drops a short option and its value", () => {
    const line = Cmd.of(["rm", "-c", "app", "FOO"]).without(["-c"]);

    expect(line.toString()).toBe("rm FOO");
  });

  it("keeps an option it was not asked to drop", () => {
    const line = Cmd.of(["rm", "--env", "prod"]).without(["--cwd"]);

    expect(line.toString()).toBe("rm --env prod");
  });

  it("drops an option that appears more than once", () => {
    const line = Cmd.of(["rm", "--cwd", "a", "FOO", "--cwd=b"]).without(["--cwd"]);

    expect(line.toString()).toBe("rm FOO");
  });

  it("takes the word after an option as its value, even when that word is an option name", () => {
    const line = Cmd.of(["rm", "--cwd", "--env", "prod"]).without(["--cwd", "--env"]);

    expect(line.toString()).toBe("rm prod");
  });
});

describe("Cmd#without on a long line", () => {
  it("strips a very long argument list without recursing", () => {
    const words = ["rm", ...Array.from({ length: 200_000 }, (_, at) => `arg${at}`), "--cwd", "app"];

    const line = Cmd.of(words).without(["--cwd"]);

    expect(line.toString().endsWith("arg199999")).toBe(true);
  });
});

describe("Cmd immutability", () => {
  it("leaves the line it was called on unchanged", () => {
    const original = Cmd.of(["rm", "--cwd", "app", "FOO"]);

    original.without(["--cwd"]);

    expect(original.toString()).toBe("rm --cwd app FOO");
  });

  it("is not changed by the array it was made from", () => {
    const words = ["rm", "FOO"];
    const line = Cmd.of(words);

    words.push("--force");

    expect(line.toString()).toBe("rm FOO");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(Cmd.of(["rm"]))).toBe(true);
  });
});
