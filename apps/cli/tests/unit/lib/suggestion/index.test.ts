import { Flags } from "@oclif/core";
import { describe, expect, expectTypeOf, it } from "vitest";

import { aSuggest } from "@tests/helpers/suggestions";
import { thrownBy } from "@tests/helpers/thrown-value";

import {
  Spelling,
  WHAT_CHANGED,
  andTheRest,
  commandOf,
  declaredOf,
  distinct,
  helpOf,
  isSuggestion,
  pipedFrom,
  readingFrom,
  renderSuggestion,
  shellCommand,
  shellSteps,
  spelled,
  suggestedCommandOf,
  suggestionWords,
  type Declared,
  type FlagsOf,
  type HelpNext,
  type Next,
  type SuggestedCommand,
  type Suggestion,
  type SuggestionId,
} from "@/lib/suggestion";
import { relatedFlags } from "@/lib/suggestion/relations";
import { type PackageCommand, PM } from "@/lib/pm";
import { CliPackage } from "@/lib/upgrade";

const VERSION = "1.0.0-alpha.25";

/** An add given a valued option before its verb, as a directory flag is. */
const FILTERED_ADD = PM.named("pnpm").add(["x"]).inDirectory("app", "/abs/app");

/** A run of this CLI's binary as a project script. */
const CLI_RUN = PM.named("yarn").script(Spelling.BINARY);

/** An SDK pinned at an exact version, as a dependency check installs it. */
const SDK_PIN = "@zitadel/sdk-next@1.0.0";

/** A commit message quoted as one shell word, which names the CLI and a `;`. */
const QUOTED_MESSAGE = "'don'\\''t; zitadel deploy again'";

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

/** A command whose one switch is required, as no command in the table has yet. */
const RequiredSwitch = {
  flags: relatedFlags(
    { confirm: Flags.boolean({ description: "Confirm it." }) },
    { confirm: { required: true } },
  ),
};

describe("FlagsOf", () => {
  it("takes a required switch given on", () => {
    expectTypeOf<{ confirm: true }>().toExtend<FlagsOf<typeof RequiredSwitch>>();
  });

  it("takes no required switch given off", () => {
    expectTypeOf<{ confirm: false }>().not.toExtend<FlagsOf<typeof RequiredSwitch>>();
  });

  it("takes no required switch left out", () => {
    expectTypeOf<Record<never, never>>().not.toExtend<FlagsOf<typeof RequiredSwitch>>();
  });
});

describe("NextTable", () => {
  it("names a generated resource command under each verb its descriptor has", () => {
    expectTypeOf<"user:get">().toExtend<SuggestionId>();
    expectTypeOf<"release:list">().toExtend<SuggestionId>();
    expectTypeOf<"session:revoke">().toExtend<SuggestionId>();
    expectTypeOf<"team:deactivate">().toExtend<SuggestionId>();
  });

  it("names no generated command for a verb its descriptor lacks", () => {
    expectTypeOf<"event:create">().not.toExtend<SuggestionId>();
    expectTypeOf<"session:delete">().not.toExtend<SuggestionId>();
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

  it("takes a value left to fill in for any flag that takes one", () => {
    expect(aSuggest({}, VERSION)({ id: "start", flags: { port: "<port>" } })).toBe(
      "npx @zitadel/cli@1.0.0-alpha.25 start --port '<port>'",
    );
  });

  it("does not compile with a value left to fill in for a switch", () => {
    // @ts-expect-error a switch takes no value to fill in
    checked({ id: "doctor", flags: { fix: "<fix>" } });
  });

  it("does not compile with a value to fill in written without angle brackets", () => {
    // @ts-expect-error a value to fill in is written in angle brackets
    checked({ id: "start", flags: { port: "port" } });
  });

  it("does not compile for a command that does not exist, or a command line as text", () => {
    // @ts-expect-error there is no `deplyo`
    checked({ id: "deplyo" });
    // @ts-expect-error a suggestion names its target by id, never as a command line
    checked({ id: "deploy --dry-run" });
    // @ts-expect-error the generated `event` resource has no create
    checked({ id: "event:create" });
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
    expect(
      distinct([shellCommand("docker", "version"), shellCommand("docker", "version")]),
    ).toEqual(["docker version"]);
  });
});

describe("a suggested help", () => {
  const help = (next: HelpNext): HelpNext => {
    return next;
  };

  it("is the command's help, named by its id", () => {
    expect(aSuggest({ cwd: "apps/web" }, VERSION)(help({ id: "variable:get", help: true }))).toBe(
      "npx @zitadel/cli@1.0.0-alpha.25 variable get --help",
    );
  });

  it("does not compile for a command that does not exist", () => {
    // @ts-expect-error there is no `varaible get`
    help({ id: "varaible:get", help: true });
    // @ts-expect-error a help names its command by id, never as a command line
    help({ id: "variable get", help: true });

    expect(help({ id: "deploy", help: true })).toBeDefined();
  });

  it("does not compile with flags, which the help would not read", () => {
    // @ts-expect-error the help takes no flags
    help({ id: "deploy", help: true, flags: { message: WHAT_CHANGED } });

    expect(help({ id: "deploy", help: true })).toBeDefined();
  });

  it("is the help of a command only known at run time", () => {
    expect(aSuggest({}, VERSION)(helpOf("variable:get"))).toBe(
      "npx @zitadel/cli@1.0.0-alpha.25 variable get --help",
    );
  });

  it("refuses, when rendered, a command known at run time that does not exist", () => {
    expect(() => {
      return aSuggest({}, VERSION)(helpOf("varaible:get"));
    }).toThrow("varaible:get is not a command");
  });

  it("refuses, when rendered, input the help would not read", () => {
    expect(() => {
      return suggestionWords(
        "variable:get",
        { help: true, args: { name: "API_KEY" } },
        { flags: new Map(), args: ["name"], requiredArgs: ["name"] },
        {},
      );
    }).toThrow("variable:get's help takes no arguments or flags");
  });
});

describe("shellCommand", () => {
  it("is its program and its words, as written", () => {
    expect(shellCommand("docker", "pull", "ghcr.io/zitadel/zitadel")).toBe(
      "docker pull ghcr.io/zitadel/zitadel",
    );
  });

  it("does not compile for the CLI", () => {
    // @ts-expect-error the CLI is suggested as an object the renderer checks
    shellCommand("zitadel", "deploy");
  });

  it("does not compile for a runner", () => {
    // @ts-expect-error a runner runs whatever it is given, the CLI included
    shellCommand("npx", CliPackage.NAME);
  });

  it("does not compile for a package manager", () => {
    // @ts-expect-error a package manager's command goes through suggestedCommandOf
    shellCommand("pnpm", "dlx", CliPackage.NAME);
  });

  it("takes a word that only names the CLI, as a commit message does", () => {
    expect(shellCommand("git", "commit", "-m", QUOTED_MESSAGE)).toBe(
      `git commit -m ${QUOTED_MESSAGE}`,
    );
  });
});

describe("suggestedCommandOf", () => {
  it.each<[string, PackageCommand]>([
    ["an install", PM.named("npm").addExact([SDK_PIN])],
    ["a script in another directory", PM.named("npm").dev().inDirectory("app", "/abs/app")],
    ["an install in a directory named exec", PM.named("pnpm").install().inDirectory("exec", "/x")],
    ["a removal of a package named like the CLI", PM.named("npm").remove([Spelling.BINARY])],
  ])("is %s as its display shows it", (_what, command) => {
    expect(suggestedCommandOf(command)).toBe(command.display);
  });

  it("is a command whose verb follows an option's value", () => {
    expect(suggestedCommandOf(FILTERED_ADD)).toBe(FILTERED_ADD.display);
  });

  it("refuses a run of the CLI's binary", () => {
    const error = thrownBy(() => {
      return suggestedCommandOf(CLI_RUN);
    });

    expect(error).toMatchObject({
      message: `${CLI_RUN.display} runs the CLI: suggest it as { id, args, flags }`,
    });
  });

  it("is never a command that runs a package", () => {
    expectTypeOf<"dlx">().not.toExtend<PackageCommand["verb"]>();
  });
});

describe("shellSteps", () => {
  it("runs each command after the one before it worked", () => {
    expect(
      shellSteps(shellCommand("cd", "app"), suggestedCommandOf(PM.named("npm").remove(["x"]))),
    ).toBe("cd app && npm uninstall x");
  });
});

describe("pipedFrom", () => {
  it("feeds the command a secret from a shell variable", () => {
    expect(pipedFrom("CLIENT_SECRET", shellCommand("git", "status"))).toBe(
      `printf '%s' "$CLIENT_SECRET" | git status`,
    );
  });

  it("refuses a name no shell variable has", () => {
    const error = thrownBy(() => {
      return pipedFrom("A; zitadel", shellCommand("git", "status"));
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: "A; zitadel is no shell variable's name" });
  });
});

describe("readingFrom", () => {
  it("puts the redirection after the command", () => {
    expect(readingFrom(shellCommand("git", "status"), "my value.txt")).toBe(
      "git status < 'my value.txt'",
    );
  });
});

describe("andTheRest", () => {
  it("follows the command with an ellipsis for everything else it was given", () => {
    expect(andTheRest(shellCommand("git", "status"))).toBe("git status ...");
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
      return suggestionWords("user:list", { args: { id: "1" } }, LIST, {});
    }).toThrow("user:list requires --kind");
  });

  it("refuses two flags the target declares exclusive", () => {
    expect(() => {
      return suggestionWords(
        "user:list",
        { args: { id: "1" }, flags: { kind: "k", all: true, pageToken: "t" } },
        LIST,
        {},
      );
    }).toThrow("user:list refuses --all with --page-token");
  });

  it("refuses a flag whose dependsOn is left out", () => {
    expect(() => {
      return suggestionWords(
        "user:list",
        { args: { id: "1" }, flags: { kind: "k", force: true } },
        LIST,
        {},
      );
    }).toThrow("user:list takes --force only with --fix");
  });

  it("refuses an argument the target requires, left out", () => {
    expect(() => {
      return suggestionWords("user:list", { flags: { kind: "k" } }, LIST, {});
    }).toThrow("user:list requires its id");
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
