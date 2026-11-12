import { describe, expect, it } from "vitest";

import {
  commandOf,
  type Declared,
  declaredOf,
  renderSuggestion,
  spelled,
  suggestion,
  suggestionWords,
} from "@/lib/suggestion";

const VERSION = "1.0.0-alpha.25";

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
        suggestion("variable:get", { args: { name: "FOO" } }),
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
