import { describe, expect, test } from "vitest";

import { EXIT_MARKER, HOOKS_PATH, MAX_EXAMPLES, SchemathesisCommand, SEED } from "./command";

/** The hooks the lane loads into every run (it keeps a made-up page token out of the requests), and no bytecode written beside them. */
const HOOKS_ENVIRONMENT = { SCHEMATHESIS_HOOKS: HOOKS_PATH, PYTHONDONTWRITEBYTECODE: "1" };

const CHECKS_TABLE =
  "[checks]\nenabled = false\n\n" +
  "[checks.not_a_server_error]\nenabled = true\n\n" +
  "[checks.ignored_auth]\nenabled = true\n";

function command(overrides: Partial<ConstructorParameters<typeof SchemathesisCommand>[0]> = {}) {
  return new SchemathesisCommand({
    checks: ["not_a_server_error", "ignored_auth"],
    url: "http://host.docker.internal:1/api/v1",
    headers: {},
    schemes: {},
    operationIds: [],
    ...overrides,
  });
}

describe("SchemathesisCommand", () => {
  test("runs with a fixed seed and example count", () => {
    const shell = command().toShell();

    expect(shell).toContain(`--seed ${String(SEED)}`);
    expect(shell).toContain(`--max-examples ${String(MAX_EXAMPLES)}`);
  });

  test("selects the checks in the config, never with a flag that would override an exemption", () => {
    expect(command().toShell()).not.toContain("--checks");
    expect(command().config()).toBe(CHECKS_TABLE);
  });

  test("keeps header values out of the command line", () => {
    const secret = command({ headers: { Authorization: "Bearer s3cret" } });

    expect(secret.toShell()).not.toContain("s3cret");
    expect(secret.toShell()).toContain('-H "$HEADER_0"');
    expect(secret.environment()).toEqual({
      ...HOOKS_ENVIRONMENT,
      HEADER_0: "Authorization: Bearer s3cret",
    });
  });

  test("numbers several headers in order", () => {
    const several = command({ headers: { A: "1", B: "2" } });

    expect(several.toShell()).toContain('-H "$HEADER_0" -H "$HEADER_1"');
    expect(several.environment()).toEqual({
      ...HOOKS_ENVIRONMENT,
      HEADER_0: "A: 1",
      HEADER_1: "B: 2",
    });
  });

  test("adds no header flag and no environment when there are no headers", () => {
    expect(command().toShell()).not.toContain("-H ");
    expect(command().environment()).toEqual(HOOKS_ENVIRONMENT);
  });

  test("limits the run to the operations it is given", () => {
    const shell = command({ operationIds: ["getMyUser", "listThings"] }).toShell();

    expect(shell).toContain(
      "--include-operation-id 'getMyUser' --include-operation-id 'listThings'",
    );
  });

  test("quotes an operation id that holds a quote", () => {
    expect(command({ operationIds: ["it's"] }).toShell()).toContain(`'it'\\''s'`);
  });

  test("loads the hooks file the run copies into its work folder", () => {
    expect(HOOKS_PATH).toBe("/work/hooks.py");
    expect(command().environment().SCHEMATHESIS_HOOKS).toBe(HOOKS_PATH);
  });

  test("prints the exit status on a line of its own and exits zero", () => {
    expect(command().toShell()).toContain(`printf '\\n%s %s\\n' "${EXIT_MARKER}" "$rc"; exit 0`);
  });

  describe("check exemptions", () => {
    test("switch a check off for the exempt operation only", () => {
      expect(
        command({
          operationIds: ["getTeam", "getUser"],
          exemptions: [{ operationId: "getTeam", check: "use_after_free" }],
        }).config(),
      ).toBe(
        `${CHECKS_TABLE}\n` +
          '[[operations]]\ninclude-operation-id = "getTeam"\n\n' +
          "[operations.checks.use_after_free]\nenabled = false\n",
      );
    });

    test("leave a run without exemptions alone", () => {
      expect(command({ operationIds: ["getUser"] }).config()).toBe(CHECKS_TABLE);
    });
  });

  describe("scheme credentials", () => {
    const schemes = {
      oauth2: { kind: "bearer", value: "s3cret" },
      sessionCookie: { kind: "cookie", value: "c00kie" },
    } as const;

    test("write one auth table per scheme, reading each value from the environment", () => {
      expect(command({ schemes }).config()).toBe(
        [
          CHECKS_TABLE,
          '[auth.openapi."oauth2"]\nbearer = "${SCHEME_0}"\n',
          '[auth.openapi."sessionCookie"]\napi_key = "${SCHEME_1}"\n',
        ].join("\n"),
      );
    });

    test("keep their values out of the command line and the config", () => {
      const shell = command({ schemes }).toShell();

      expect(shell).not.toContain("s3cret");
      expect(shell).not.toContain("c00kie");
      expect(command({ schemes }).config()).not.toContain("s3cret");
      expect(command({ schemes }).environment()).toEqual({
        ...HOOKS_ENVIRONMENT,
        SCHEME_0: "s3cret",
        SCHEME_1: "c00kie",
      });
    });

    test("point Schemathesis at the config file", () => {
      expect(command().toShell()).toMatch(
        /^schemathesis --config-file \/work\/schemathesis.toml run/,
      );
    });

    test("let a refusing operation answer 400, and no other", () => {
      expect(command({ refusals: ["createIdp"] }).config()).toBe(
        `${CHECKS_TABLE}\n` +
          '[[operations]]\ninclude-operation-id = "createIdp"\n\n' +
          "[operations.checks.positive_data_acceptance]\n" +
          'expected-statuses = ["2xx", "3xx", "401", "403", "404", "409", "429", "5xx", "400"]\n',
      );
    });
  });
});
