import { describe, expect, test } from "vitest";

import { HOOKS_PATH, MAX_EXAMPLES, WORKERS, SchemathesisCommand, SEED } from "./command";

/** The hooks the lane loads into every run (it keeps a made-up page token out of the requests), and no bytecode written beside them. */
const HOOKS_ENVIRONMENT = { SCHEMATHESIS_HOOKS: HOOKS_PATH, PYTHONDONTWRITEBYTECODE: "1" };

const CHECKS_TABLE =
  "[checks]\nenabled = false\n\n" +
  "[checks.not_a_server_error]\nenabled = true\n\n" +
  "[checks.ignored_auth]\nenabled = true\n";

function command(overrides: Partial<ConstructorParameters<typeof SchemathesisCommand>[0]> = {}) {
  return new SchemathesisCommand({
    checks: ["not_a_server_error", "ignored_auth"],
    name: "all",
    url: "http://host.docker.internal:1/api/v1",
    schemes: {},
    operationIds: [],
    ...overrides,
  });
}

describe("SchemathesisCommand", () => {
  test("runs with a fixed seed and example count", () => {
    const args = command().toArgs();

    expect(args).toContain(String(SEED));
    expect(args.slice(args.indexOf("--max-examples"))[1]).toBe(String(MAX_EXAMPLES));
    expect(args.slice(args.indexOf("--workers"))[1]).toBe(String(WORKERS));
  });

  test("keeps no example database, so a run never replays the examples of an earlier one", () => {
    const args = command().toArgs();

    expect(args.slice(args.indexOf("--generation-database"))[1]).toBe("none");
  });

  test("selects the checks in the config, never with a flag that would override an exemption", () => {
    expect(command().toArgs()).not.toContain("--checks");
    expect(command().config()).toBe(CHECKS_TABLE);
  });

  test("keeps a command's files in a folder of its own", () => {
    const logout = command({ name: "logout" });

    expect(logout.reportPath).toBe("/work/logout/report.json");
    expect(logout.toArgs()).toEqual(
      expect.arrayContaining([
        "--config-file",
        "/work/logout/schemathesis.toml",
        "--report-json-path",
        "/work/logout/report.json",
      ]),
    );
  });

  describe("operation headers", () => {
    const operationHeaders = { getMySession: { "X-Zitadel-CSRF": "t0ken" } };

    test("go in a table for their operation only, reading the value from the environment", () => {
      expect(command({ operationHeaders }).config()).toBe(
        `${CHECKS_TABLE}\n` +
          '[[operations]]\ninclude-operation-id = "getMySession"\n\n' +
          '[operations.headers]\n"X-Zitadel-CSRF" = "${HEADER_0}"\n',
      );
    });

    test("keep their values out of the command line and the config", () => {
      const subject = command({ operationHeaders });

      expect(subject.toArgs().join(" ")).not.toContain("t0ken");
      expect(subject.config()).not.toContain("t0ken");
      expect(subject.environment()).toEqual({ ...HOOKS_ENVIRONMENT, HEADER_0: "t0ken" });
    });

    test("add no table and no environment when there are none", () => {
      expect(command().config()).toBe(CHECKS_TABLE);
      expect(command().environment()).toEqual(HOOKS_ENVIRONMENT);
    });
  });

  test("limits the run to the operations it is given", () => {
    const args = command({ operationIds: ["getMyUser", "listThings"] }).toArgs();

    expect(args).toEqual(
      expect.arrayContaining([
        "--include-operation-id",
        "getMyUser",
        "--include-operation-id",
        "listThings",
      ]),
    );
  });

  test("passes an operation id that holds a quote as it is, since no shell reads it", () => {
    expect(command({ operationIds: ["it's"] }).toArgs()).toContain("it's");
  });

  test("loads the hooks file the container's start copies into its work folder", () => {
    expect(HOOKS_PATH).toBe("/work/hooks.py");
    expect(command().environment().SCHEMATHESIS_HOOKS).toBe(HOOKS_PATH);
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
      const args = command({ schemes }).toArgs().join(" ");

      expect(args).not.toContain("s3cret");
      expect(args).not.toContain("c00kie");
      expect(command({ schemes }).config()).not.toContain("s3cret");
      expect(command({ schemes }).environment()).toEqual({
        ...HOOKS_ENVIRONMENT,
        SCHEME_0: "s3cret",
        SCHEME_1: "c00kie",
      });
    });

    test("point Schemathesis at the config file", () => {
      expect(command().toArgs().slice(0, 4)).toEqual([
        "schemathesis",
        "--config-file",
        "/work/all/schemathesis.toml",
        "run",
      ]);
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
