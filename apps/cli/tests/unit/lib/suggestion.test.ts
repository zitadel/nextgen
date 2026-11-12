import { describe, expect, expectTypeOf, it } from "vitest";

import {
  commandOf,
  type Declared,
  declaredOf,
  distinct,
  helpCommand,
  inShell,
  isSuggestion,
  type Next,
  renderSuggestion,
  type SuggestedCommand,
  type SuggestionId,
  type Suggestion,
  shellCommand,
  spelled,
  suggestionWords,
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
    // @ts-expect-error --fix given off does not satisfy it
    checked({ id: "doctor", flags: { force: true, fix: false } });

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

  it("reads two suggestions written in a different order as the same", () => {
    expect(
      distinct([
        { id: "variable:get", args: { name: "A" } },
        { args: { name: "A" }, id: "variable:get" },
      ]),
    ).toHaveLength(1);
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

/** A command that resolves an environment, as `deploy` does. */
const PROJECT: Declared = {
  flags: new Map([
    ["message", { type: "option" }],
    ["force", { type: "boolean" }],
    ["open", { type: "boolean", allowNo: true }],
    ["origin", { type: "option" }],
    ["cwd", { type: "option" }],
    ["server", { type: "option" }],
    ["env", { type: "option" }],
    ["env-file", { type: "option" }],
  ]),
  args: ["name"],
};

/** A command that chooses no environment, as `setup` does. */
const LOCAL: Declared = {
  flags: new Map([
    ["cwd", { type: "option" }],
    ["server", { type: "option" }],
  ]),
  args: [],
};

describe("suggestionWords", () => {
  it("names the id as words, then the arguments, then the flags given", () => {
    expect(
      suggestionWords(
        "variable:get",
        { args: { name: "FOO" }, flags: { message: "m", force: true } },
        PROJECT,
        {},
      ),
    ).toEqual(["variable", "get", "FOO", "--message", "m", "--force"]);
  });

  it("puts the run's environment selection and directory on a command that resolves one", () => {
    expect(
      suggestionWords("deploy", {}, PROJECT, {
        cwd: "app",
        env: "production",
        server: "https://a.example",
      }),
    ).toEqual(["deploy", "--env", "production", "--server", "https://a.example", "--cwd", "app"]);
  });

  it("carries an env file in place of the environment's name", () => {
    expect(suggestionWords("deploy", {}, PROJECT, { envFile: ".env.ci", env: "ci" })).toEqual([
      "deploy",
      "--env-file",
      ".env.ci",
    ]);
  });

  it("puts only the directory on a command that chooses no environment", () => {
    expect(
      suggestionWords("setup", {}, LOCAL, { cwd: "app", env: "production", server: "https://a" }),
    ).toEqual(["setup", "--cwd", "app"]);
  });

  it("lets a suggestion that names its own environment replace the run's selection", () => {
    expect(
      suggestionWords("deploy", { flags: { env: "staging" } }, PROJECT, {
        envFile: ".env.ci",
        cwd: "app",
      }),
    ).toEqual(["deploy", "--env", "staging", "--cwd", "app"]);
  });

  it("lets a suggestion that names its own directory replace the run's", () => {
    expect(suggestionWords("setup", { flags: { cwd: "other" } }, LOCAL, { cwd: "app" })).toEqual([
      "setup",
      "--cwd",
      "other",
    ]);
  });

  it("joins a value that reads as a flag to its flag", () => {
    expect(suggestionWords("deploy", { flags: { message: "-x" } }, PROJECT, {})).toEqual([
      "deploy",
      "--message=-x",
    ]);
  });

  it("puts an argument that reads as a flag after a --", () => {
    expect(
      suggestionWords("variable:get", { args: { name: "-x" }, flags: { force: true } }, PROJECT, {
        cwd: "app",
      }),
    ).toEqual(["variable", "get", "--force", "--cwd", "app", "--", "-x"]);
  });

  it("puts the words beyond the declared arguments after them, before the flags", () => {
    expect(
      suggestionWords(
        "variable:get",
        { args: { name: "FOO" }, rest: ["BAR"], flags: { force: true } },
        PROJECT,
        {},
      ),
    ).toEqual(["variable", "get", "FOO", "BAR", "--force"]);
  });

  it("gives a flag once per item of a list", () => {
    expect(suggestionWords("deploy", { flags: { origin: ["a", "b"] } }, PROJECT, {})).toEqual([
      "deploy",
      "--origin",
      "a",
      "--origin",
      "b",
    ]);
  });

  it("leaves out a switch that is off, or says --no- where the switch takes it", () => {
    expect(
      suggestionWords("deploy", { flags: { force: false, open: false } }, PROJECT, {}),
    ).toEqual(["deploy", "--no-open"]);
  });

  it("refuses a flag the target does not declare", () => {
    expect(() => {
      return suggestionWords("setup", { flags: { message: "m" } }, LOCAL, {});
    }).toThrow("setup declares no --message");
  });

  it("refuses an argument given after one it leaves out, which would be read in its place", () => {
    const pair: Declared = { flags: new Map(), args: ["source", "target"] };

    expect(() => {
      return suggestionWords("copy", { args: { target: "b" } }, pair, {});
    }).toThrow("copy takes its target only after its source");
  });

  it("refuses an argument the target does not declare", () => {
    expect(() => {
      return suggestionWords("setup", { args: { name: "x" } }, LOCAL, {});
    }).toThrow("setup declares no argument name");
  });
});

describe("suggestionWords, for a target only known at run time", () => {
  /** A generated list command, whose relations the compiler does not see. */
  const LIST: Declared = {
    flags: new Map([
      ["all", { type: "boolean", exclusive: ["page-token"] }],
      ["page-token", { type: "option" }],
      ["fix", { type: "boolean" }],
      ["force", { type: "boolean", dependsOn: ["fix"] }],
      ["kind", { type: "option", required: true }],
    ]),
    args: ["id"],
    requiredArgs: ["id"],
  };

  it("refuses a flag the target requires, left out", () => {
    expect(() => {
      return suggestionWords("users:list", { args: { id: "1" } }, LIST, {});
    }).toThrow("users:list requires --kind");
  });

  it("refuses two flags the target declares exclusive", () => {
    expect(() => {
      return suggestionWords(
        "users:list",
        { args: { id: "1" }, flags: { kind: "k", all: true, pageToken: "t" } },
        LIST,
        {},
      );
    }).toThrow("users:list refuses --all with --page-token");
  });

  it("refuses a flag whose dependsOn is left out", () => {
    expect(() => {
      return suggestionWords(
        "users:list",
        { args: { id: "1" }, flags: { kind: "k", force: true } },
        LIST,
        {},
      );
    }).toThrow("users:list takes --force only with --fix");
  });

  it("refuses an argument the target requires, left out", () => {
    expect(() => {
      return suggestionWords("users:list", { flags: { kind: "k" } }, LIST, {});
    }).toThrow("users:list requires its id");
  });
});

describe("commandOf", () => {
  it("quotes each word the shell would read otherwise", () => {
    expect(commandOf(["deploy", "--message", "<what changed>"], VERSION)).toBe(
      "npx @zitadel/cli@1.0.0-alpha.25 deploy --message '<what changed>'",
    );
  });

  it("keeps a URL with a port as it is", () => {
    expect(commandOf(["variable", "list", "--server", "http://localhost:3000"], VERSION)).toBe(
      "npx @zitadel/cli@1.0.0-alpha.25 variable list --server http://localhost:3000",
    );
  });

  it("runs upgrade on the newest release of the train", () => {
    expect(commandOf(["upgrade"], VERSION)).toBe("npx @zitadel/cli@alpha upgrade");
  });
});

describe("declaredOf", () => {
  it("refuses a command oclif did not load", () => {
    expect(() => {
      return declaredOf("nonesuch", undefined);
    }).toThrow("nonesuch is not a command");
  });
});

describe("renderSuggestion", () => {
  it("renders a deferred suggestion with the run's scope", () => {
    expect(
      renderSuggestion(
        { id: "variable:get", args: { name: "FOO" } },
        PROJECT,
        { env: "production" },
        VERSION,
      ),
    ).toBe("npx @zitadel/cli@1.0.0-alpha.25 variable get FOO --env production");
  });
});

describe("spelled", () => {
  it("spells a name as code reads it the way the command line takes it", () => {
    expect(spelled("envFile")).toBe("env-file");
  });
});
