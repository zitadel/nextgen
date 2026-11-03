import { describe, expect, it } from "vitest";

import {
  previewVerdict,
  runsInCi,
} from "../../../../../src/commands/preview/requirements/previewable";

const READY = {
  environment: "preview",
  fromDefault: false,
  ci: false,
  credentialSet: true,
  strict: false,
};

describe("previewVerdict", () => {
  it("deploys a preview build that has its credential", () => {
    expect(previewVerdict(READY)).toBe("preview");
  });

  it("deploys a development build on a developer's machine", () => {
    expect(previewVerdict({ ...READY, environment: "development", fromDefault: true })).toBe(
      "preview",
    );
  });

  it("skips a production build, which `deploy` publishes after merge", () => {
    expect(previewVerdict({ ...READY, environment: "production" })).toBe("production-build");
  });

  it("skips a CI build that names no environment, which may be production", () => {
    expect(
      previewVerdict({ ...READY, environment: "development", fromDefault: true, ci: true }),
    ).toBe("unnamed-ci-build");
  });

  it("skips a build without the credential, as a fork pull request has none", () => {
    expect(previewVerdict({ ...READY, credentialSet: false })).toBe("no-credential");
  });

  it("refuses a build without the credential under --strict", () => {
    expect(previewVerdict({ ...READY, credentialSet: false, strict: true })).toBe(
      "credential-required",
    );
  });
});

describe("runsInCi", () => {
  it.each([{ CI: "true" }, { CF_PAGES: "1" }, { TF_BUILD: "True" }, { CODEBUILD_BUILD_ID: "1" }])(
    "recognises %j",
    (env) => {
      expect(runsInCi(env)).toBe(true);
    },
  );

  it("is false on a machine with none of them", () => {
    expect(runsInCi({})).toBe(false);
  });
});
