import { execFileSync } from "node:child_process";

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

  it("quotes a word that starts with `=`, which a shell would expand", () => {
    expect(Cmd.quote("=cmd")).toBe("'=cmd'");
  });

  it.each([
    { name: "a tab", value: "my\tdir", quoted: "$'my\\tdir'" },
    { name: "a newline", value: "a\nb", quoted: "$'a\\nb'" },
    { name: "a carriage return", value: "a\rb", quoted: "$'a\\rb'" },
    { name: "ESC before a hex digit", value: "a\u001bb", quoted: "$'a\\x1bb'" },
    { name: "DEL", value: "a\u007fb", quoted: "$'a\\x7fb'" },
    { name: "a C1 control", value: "a\u009bb", quoted: "$'a\\xc2\\x9bb'" },
    { name: "a bidi override", value: "a‮b", quoted: "$'a\\xe2\\x80\\xaeb'" },
    { name: "a tag character", value: "a\u{e0041}b", quoted: "$'a\\xf3\\xa0\\x81\\x81b'" },
    { name: "a single quote beside a tab", value: "it's\t", quoted: "$'it\\'s\\t'" },
    { name: "a backslash beside a tab", value: "a\\b\t", quoted: "$'a\\\\b\\t'" },
  ])("writes a value holding $name in ANSI-C quotes", ({ value, quoted }) => {
    expect(Cmd.quote(value)).toBe(quoted);
  });

  it.each([
    "my\tdir",
    "a\nb",
    "a\rb",
    "a\u001bb",
    "a\u007fb",
    "a\u009bb",
    "a‮b",
    "a\u{e0041}b",
    "it's\t",
    "a\\b\t",
    "$(whoami)\n",
  ])("is read back by bash as the value it quoted (%j)", (value) => {
    const read = execFileSync("bash", ["-c", `printf '%s' ${Cmd.quote(value)}`], {
      encoding: "utf8",
    });

    expect(read).toBe(value);
  });

  it("leaves a plain safe word unchanged", () => {
    expect(Cmd.quote("my-app_1.0")).toBe("my-app_1.0");
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
