import { describe, expect, it } from "vitest";

import { assertSuggestionsCarryTheRun } from "@tests/helpers/suggestions";
import { thrownBy } from "@tests/helpers/thrown-value";

const RAN = ["deploy", "--cwd", "/app", "--server", "http://localhost:8080"];

/** What a failure names the run as. */
const WHERE = "`deploy`";

describe("assertSuggestionsCarryTheRun", () => {
  it("passes a command that names the run's directory and server", () => {
    const thrown = thrownBy(() => {
      assertSuggestionsCarryTheRun(
        WHERE,
        {
          next_commands: [
            "npx @zitadel/cli@0.1.0 deploy --dry-run --server http://localhost:8080 --cwd /app",
          ],
        },
        RAN,
      );
    });

    expect(thrown).toBeUndefined();
  });

  it("passes a command aimed at another environment, which is no default", () => {
    const thrown = thrownBy(() => {
      assertSuggestionsCarryTheRun(
        WHERE,
        { next_commands: ["npx @zitadel/cli@0.1.0 deploy --env staging --cwd /app"] },
        RAN,
      );
    });

    expect(thrown).toBeUndefined();
  });

  it.each([
    ["names no environment", "npx @zitadel/cli@0.1.0 deploy --dry-run --cwd /app"],
    [
      "names no directory",
      "npx @zitadel/cli@0.1.0 deploy --dry-run --server http://localhost:8080",
    ],
  ])("fails a command that %s", (_why, command) => {
    const thrown = thrownBy(() => {
      assertSuggestionsCarryTheRun(WHERE, { next_commands: [command] }, RAN);
    });

    expect(thrown).toBeInstanceOf(Error);
  });

  it.each([
    ["--server=", ["deploy", "--cwd", "/app", "--server=http://localhost:8080"]],
    ["--env=", ["deploy", "--cwd", "/app", "--env=staging"]],
    ["--env-file=", ["deploy", "--cwd", "/app", "--env-file=.env.production"]],
  ])("holds a command to a run that gave %s inline", (_form, ran) => {
    const thrown = thrownBy(() => {
      assertSuggestionsCarryTheRun(
        WHERE,
        { next_commands: ["npx @zitadel/cli@0.1.0 deploy --dry-run --cwd /app"] },
        ran,
      );
    });

    expect(thrown).toBeInstanceOf(Error);
  });

  it("holds a command to the directory a run gave inline", () => {
    const thrown = thrownBy(() => {
      assertSuggestionsCarryTheRun(WHERE, { next_commands: ["npx @zitadel/cli@0.1.0 start"] }, [
        "start",
        "--cwd=/app",
      ]);
    });

    expect(thrown).toBeInstanceOf(Error);
  });

  it("holds the commands in the data to it as well", () => {
    const thrown = thrownBy(() => {
      assertSuggestionsCarryTheRun(
        WHERE,
        { data: { next_commands: ["npx @zitadel/cli@0.1.0 deploy"] } },
        RAN,
      );
    });

    expect(thrown).toBeInstanceOf(Error);
  });

  it("asks only for the directory of a command that takes no environment", () => {
    const thrown = thrownBy(() => {
      assertSuggestionsCarryTheRun(
        WHERE,
        { next_commands: ["npx @zitadel/cli@0.1.0 start --cwd /app"] },
        RAN,
      );
    });

    expect(thrown).toBeUndefined();
  });

  it.each([
    ["a command that is not the CLI's", "npm run dev"],
    ["a request for help", "npx @zitadel/cli@0.1.0 deploy --help"],
  ])("leaves out %s", (_what, command) => {
    const thrown = thrownBy(() => {
      assertSuggestionsCarryTheRun(WHERE, { next_commands: [command] }, RAN);
    });

    expect(thrown).toBeUndefined();
  });

  it("asks for nothing of a run that was aimed at no project", () => {
    const thrown = thrownBy(() => {
      assertSuggestionsCarryTheRun(
        WHERE,
        { next_commands: ["npx @zitadel/cli@0.1.0 deploy --dry-run"] },
        ["deploy"],
      );
    });

    expect(thrown).toBeUndefined();
  });
});
