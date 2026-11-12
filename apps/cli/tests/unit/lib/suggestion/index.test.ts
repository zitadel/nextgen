import { describe, expect, expectTypeOf, it } from "vitest";

import {
  distinct,
  helpCommand,
  inShell,
  isSuggestion,
  type Next,
  type SuggestedCommand,
  type SuggestionId,
  type Suggestion,
  shellCommand,
  WHAT_CHANGED,
} from "@/lib/suggestion";

const VERSION = "1.0.0-alpha.25";

/**
 * Holds `next` to the type every suggestion is written as, so a
 * `@ts-expect-error` above a call proves that suggestion does not compile.
 *
 * @param next - The suggestion.
 * @returns It, unchanged.
 */
function checked(next: Next): Next {
  return next;
}

describe("NextTable", () => {
  it("names a generated resource command under each verb its descriptor has", () => {
    expectTypeOf<"users:get">().toExtend<SuggestionId>();
    expectTypeOf<"release:list">().toExtend<SuggestionId>();
    expectTypeOf<"sessions:revoke">().toExtend<SuggestionId>();
    expectTypeOf<"teams:deactivate">().toExtend<SuggestionId>();
  });

  it("names no generated command for a verb its descriptor lacks", () => {
    expectTypeOf<"events:create">().not.toExtend<SuggestionId>();
    expectTypeOf<"sessions:delete">().not.toExtend<SuggestionId>();
  });
});

/**
 * Each mistake a hand-written suggestion could make, which the compiler now
 * refuses. A `@ts-expect-error` that stops erroring fails the typecheck, so
 * each line proves its mistake does not compile.
 */
describe("a suggestion", () => {
  it("does not compile without an argument its target requires", () => {
    // @ts-expect-error `variable get` requires its NAME
    checked({ id: "variable:get" });

    expect(checked({ id: "variable:get", args: { name: "FOO" } })).toBeDefined();
  });

  it("does not compile without a flag its target requires", () => {
    // @ts-expect-error `deployment create` requires --release
    checked({ id: "deployment:create" });
    // @ts-expect-error `origin add` requires --kind
    checked({ id: "origin:add", args: { pattern: "https://app.example" } });

    expect(checked({ id: "deployment:create", flags: { release: "rel_1" } })).toBeDefined();
  });

  it("does not compile with a flag its target does not take", () => {
    // @ts-expect-error `deploy` has no --nope
    checked({ id: "deploy", flags: { nope: true } });
    // @ts-expect-error `setup` has no --message
    checked({ id: "setup", flags: { message: WHAT_CHANGED } });
    // @ts-expect-error `setup` chooses no environment, so it takes no --env
    checked({ id: "setup", flags: { env: "production" } });
    // @ts-expect-error `start` takes no argument
    checked({ id: "start", args: { name: "x" } });
  });

  it("does not compile with a value of a type its target does not parse to", () => {
    // @ts-expect-error --kind is primary or preview
    checked({ id: "origin:add", args: { pattern: "x" }, flags: { kind: "tertiary" } });
    // @ts-expect-error --port is a number
    checked({ id: "start", flags: { port: "9080" } });
  });

  it("does not compile with two flags its target declares exclusive", () => {
    // @ts-expect-error --all and --page-token are exclusive
    checked({ id: "deployment:list", flags: { all: true, pageToken: "next" } });
    // @ts-expect-error --no-wait and --timeout are exclusive
    checked({ id: "claim", flags: { noWait: true, timeout: 120 } });

    expect(checked({ id: "deployment:list", flags: { all: true } })).toBeDefined();
  });

  it("does not compile with a flag whose dependsOn is left out", () => {
    // @ts-expect-error --force depends on --fix
    checked({ id: "doctor", flags: { force: true } });

    expect(checked({ id: "doctor", flags: { fix: true, force: true } })).toBeDefined();
  });

  it("does not compile for a command that does not exist, or a command line as text", () => {
    // @ts-expect-error there is no `deplyo`
    checked({ id: "deplyo" });
    // @ts-expect-error a suggestion names its target by id, never as a command line
    checked({ id: "deploy --dry-run" });
    // @ts-expect-error the generated `events` resource has no create
    checked({ id: "events:create" });
  });

  it("is not a command line until a run renders it", () => {
    const deploy: Suggestion = { id: "deploy", flags: { message: WHAT_CHANGED } };

    // @ts-expect-error a deferred suggestion is not a rendered command
    const rendered: SuggestedCommand = deploy;

    expect(rendered).toEqual({ id: "deploy", flags: { message: "<what changed>" } });
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
    const logs: Suggestion = { id: "logs" };

    expect(distinct([logs, { id: "stop", flags: { all: true } }, { id: "logs" }])).toEqual([
      logs,
      { id: "stop", flags: { all: true } },
    ]);
  });

  it("keeps two suggestions of one command with different input", () => {
    expect(distinct([{ id: "start" }, { id: "start", flags: { port: 9081 } }])).toHaveLength(2);
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
