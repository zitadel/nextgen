import { describe, expect, expectTypeOf, it } from "vitest";

import type { WORKFLOW_COMMANDS } from "@/index";
import {
  distinct,
  helpCommand,
  inShell,
  isSuggestion,
  type NextTable,
  type SuggestedCommand,
  type SuggestionId,
  shellCommand,
  suggestion,
  WHAT_CHANGED,
} from "@/lib/suggestion";

const VERSION = "1.0.0-alpha.25";

/** The hand-written commands whose `NextTable` entry is missing or names another class. */
type Unlisted = {
  [Id in keyof typeof WORKFLOW_COMMANDS]: Id extends SuggestionId
    ? NextTable[Id] extends (typeof WORKFLOW_COMMANDS)[Id]
      ? never
      : Id
    : Id;
}[keyof typeof WORKFLOW_COMMANDS];

describe("NextTable", () => {
  it("lists every hand-written command, as the class the command table runs", () => {
    expectTypeOf<Unlisted>().toBeNever();
  });

  it("lists the generated resource commands", () => {
    expectTypeOf<"users:get">().toExtend<SuggestionId>();
    expectTypeOf<"release:list">().toExtend<SuggestionId>();
  });
});

/**
 * Each mistake a hand-written suggestion could make, which the compiler now
 * refuses. A `@ts-expect-error` that stops erroring fails the typecheck, so
 * each line proves its mistake does not compile.
 */
describe("suggestion", () => {
  it("does not compile without an argument its target requires", () => {
    // @ts-expect-error `variable get` requires its NAME
    suggestion("variable:get");

    expectTypeOf(suggestion("variable:get", { args: { name: "FOO" } })).not.toBeNever();
  });

  it("does not compile without a flag its target requires", () => {
    // @ts-expect-error `deployment create` requires --release
    suggestion("deployment:create");
    // @ts-expect-error `origin add` requires --kind
    suggestion("origin:add", { args: { pattern: "https://app.example" } });

    expectTypeOf(suggestion("deployment:create", { flags: { release: "rel_1" } })).not.toBeNever();
  });

  it("does not compile with a flag its target does not take", () => {
    // @ts-expect-error `deploy` has no --nope
    suggestion("deploy", { flags: { nope: true } });
    // @ts-expect-error `setup` has no --message
    suggestion("setup", { flags: { message: WHAT_CHANGED } });
    // @ts-expect-error `start` takes no argument
    suggestion("start", { args: { name: "x" } });
  });

  it("does not compile with a value of a type its target does not parse to", () => {
    // @ts-expect-error --kind is primary or preview
    suggestion("origin:add", { args: { pattern: "x" }, flags: { kind: "tertiary" } });
    // @ts-expect-error --port is a number
    suggestion("start", { flags: { port: "9080" } });
  });

  it("does not compile with two flags its target declares exclusive", () => {
    // @ts-expect-error --all and --page-token are exclusive
    suggestion("deployment:list", { flags: { all: true, pageToken: "next" } });
    // @ts-expect-error --no-wait and --timeout are exclusive
    suggestion("claim", { flags: { noWait: true, timeout: 120 } });

    expectTypeOf(suggestion("deployment:list", { flags: { all: true } })).not.toBeNever();
  });

  it("does not compile with a flag whose dependsOn is left out", () => {
    // @ts-expect-error --force depends on --fix
    suggestion("doctor", { flags: { force: true } });

    expectTypeOf(suggestion("doctor", { flags: { fix: true, force: true } })).not.toBeNever();
  });

  it("does not compile for a command that does not exist, or a command line as text", () => {
    // @ts-expect-error there is no `deplyo`
    suggestion("deplyo");
    // @ts-expect-error a suggestion names its target by id, never as a command line
    suggestion("deploy --dry-run");
  });

  it("is not a command line until a run renders it", () => {
    const deploy = suggestion("deploy", { flags: { message: WHAT_CHANGED } });

    // @ts-expect-error a deferred suggestion is not a rendered command
    const rendered: SuggestedCommand = deploy;

    expect(rendered).toEqual({ id: "deploy", input: { flags: { message: "<what changed>" } } });
    expect(isSuggestion(deploy)).toBe(true);
  });

  it("leaves no way to pass a command line where a suggestion is expected", () => {
    // @ts-expect-error a string is not a rendered command
    const raw: SuggestedCommand = "npx @zitadel/cli deploy";

    expect(isSuggestion(raw)).toBe(false);
  });
});

describe("distinct", () => {
  it("keeps the first of two suggestions that name the same command with the same input", () => {
    const logs = suggestion("logs");

    expect(
      distinct([logs, suggestion("stop", { flags: { all: true } }), suggestion("logs")]),
    ).toEqual([logs, suggestion("stop", { flags: { all: true } })]);
  });

  it("keeps two suggestions of one command with different input", () => {
    expect(
      distinct([suggestion("start"), suggestion("start", { flags: { port: 9081 } })]),
    ).toHaveLength(2);
  });

  it("keeps a rendered command once", () => {
    expect(distinct([shellCommand("docker version"), shellCommand("docker version")])).toEqual([
      "docker version",
    ]);
  });
});

describe("helpCommand", () => {
  it("is the command's help", () => {
    expect(helpCommand("variable get", VERSION)).toBe(
      "npx @zitadel/cli@1.0.0-alpha.25 variable get --help",
    );
  });

  it("is the CLI's help for no command", () => {
    expect(helpCommand("", VERSION)).toBe("npx @zitadel/cli@1.0.0-alpha.25 --help");
  });
});

describe("shellCommand", () => {
  it("is suggested exactly as written", () => {
    expect(shellCommand("npm install @zitadel/cli@alpha")).toBe("npm install @zitadel/cli@alpha");
  });
});

describe("inShell", () => {
  it("puts a pipe before the command", () => {
    expect(inShell(shellCommand("cat"), { before: "printf '%s' \"$S\" | " })).toBe(
      "printf '%s' \"$S\" | cat",
    );
  });

  it("puts a redirection after it", () => {
    expect(inShell(shellCommand("cat"), { after: " < value.txt" })).toBe("cat < value.txt");
  });
});
