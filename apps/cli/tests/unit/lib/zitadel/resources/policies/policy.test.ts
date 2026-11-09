import { describe, expect, it } from "vitest";

import {
  BrokenFile,
  BrokenFilesError,
  CONFIG_DIRECTORIES,
  MemoryStore,
  Policy,
} from "@/lib/zitadel";
import { aFile, aPasswordPolicy, PASSWORD_POLICY } from "@tests/helpers/config";
import { PASSWORD_POLICY_FILE } from "@tests/helpers/policies";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * Where the password policy sits.
 */
const PATH = `${CONFIG_DIRECTORIES.policies}/${PASSWORD_POLICY_FILE}`;

/**
 * The editor's pointer at the policy meta-schema.
 */
const POINTER = "../meta/policy.json";

describe("Policy.read", () => {
  it("takes a policy the policy contract takes as a policy", () => {
    const reading = Policy.read(aFile("policies", PASSWORD_POLICY_FILE, aPasswordPolicy()));

    expect(reading).toBeInstanceOf(Policy);
  });

  it("takes a policy the policy contract refuses as a broken file", () => {
    const reading = Policy.read(
      aFile("policies", PASSWORD_POLICY_FILE, aPasswordPolicy({ min_length: "twelve" })),
    );

    expect(reading).toBeInstanceOf(BrokenFile);
  });

  it("reports what the policy contract refuses, under contract/policy", () => {
    const reading = Policy.read(
      aFile("policies", PASSWORD_POLICY_FILE, aPasswordPolicy({ min_length: "twelve" })),
    );

    expect(reading).toMatchObject({ issues: [{ rule: "contract/policy" }] });
  });
});

describe("Policy.of", () => {
  it("takes the file as read", () => {
    const policy = Policy.of(aFile("policies", PASSWORD_POLICY_FILE, aPasswordPolicy()));

    expect(policy.status).toBe("read");
  });

  it("refuses a body the policy contract refuses", () => {
    const file = aFile("policies", PASSWORD_POLICY_FILE, { operation: PASSWORD_POLICY });

    const error = thrownBy(() => {
      return Policy.of(file);
    });

    expect(error).toBeInstanceOf(BrokenFilesError);
    expect(error).toMatchObject({ problems: [{ path: PATH }] });
  });

  it("names the file and what the contract refuses in it", () => {
    const file = aFile("policies", PASSWORD_POLICY_FILE, aPasswordPolicy({ min_length: 0 }));

    const error = thrownBy(() => {
      return Policy.of(file);
    });

    expect(error).toMatchObject({
      message: expect.stringContaining(`${PATH}: config.min_length`),
    });
  });
});

describe("Policy.create", () => {
  it("takes the file as new", () => {
    const policy = Policy.create(aFile("policies", PASSWORD_POLICY_FILE, aPasswordPolicy()));

    expect(policy.status).toBe("created");
  });
});

describe("Policy.fileName", () => {
  it("names the file after its operation", () => {
    const name = Policy.fileName(PASSWORD_POLICY);

    expect(name).toBe(PASSWORD_POLICY_FILE);
  });
});

describe("Policy.operation", () => {
  it("reads the operation the policy guards", () => {
    const policy = Policy.of(aFile("policies", PASSWORD_POLICY_FILE, aPasswordPolicy()));

    const operation = policy.operation;

    expect(operation).toBe(PASSWORD_POLICY);
  });
});

describe("Policy.config", () => {
  it("reads the rules without the $schema pointer", () => {
    const policy = Policy.of(
      aFile("policies", PASSWORD_POLICY_FILE, { $schema: POINTER, ...aPasswordPolicy() }),
    );

    const config = policy.config;

    expect(config).toEqual({ min_length: 12 });
  });
});

describe("Policy.check", () => {
  it("finds nothing wrong with a policy named after its operation", () => {
    const policy = Policy.of(aFile("policies", PASSWORD_POLICY_FILE, aPasswordPolicy()));

    const problems = policy.check({});

    expect(problems).toEqual([]);
  });

  it("finds nothing wrong with the editor's $schema pointer", () => {
    const policy = Policy.of(
      aFile("policies", PASSWORD_POLICY_FILE, { $schema: POINTER, ...aPasswordPolicy() }),
    );

    const problems = policy.check({});

    expect(problems).toEqual([]);
  });

  it("names the file a policy must have when it has another", () => {
    const policy = Policy.of(aFile("policies", "password.json", aPasswordPolicy()));

    const problems = policy.check({});

    expect(problems).toEqual([
      {
        severity: "error",
        rule: "contract/policy",
        file: `${CONFIG_DIRECTORIES.policies}/password.json`,
        message: `holds the ${PASSWORD_POLICY} policy, so it must be named ${PASSWORD_POLICY_FILE}`,
      },
    ]);
  });
});

describe("Policy.toWireBody", () => {
  it("sends the operation and its rules without the $schema pointer", () => {
    const policy = Policy.of(
      aFile("policies", PASSWORD_POLICY_FILE, { $schema: POINTER, ...aPasswordPolicy() }),
    );

    const body = policy.toWireBody(new MemoryStore());

    expect(body).toEqual(aPasswordPolicy());
  });
});
