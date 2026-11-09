import { describe, expect, it } from "vitest";

import { BrokenFilesError, CONFIG_DIRECTORIES, MemoryStore, Policy } from "@/lib/zitadel";
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

describe("Policy.of", () => {
  it("takes the file as read", () => {
    const policy = Policy.of(aFile("policies", PASSWORD_POLICY_FILE, aPasswordPolicy()));

    expect(policy.status).toBe("read");
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

describe("Policy.readOperation", () => {
  it("reads the operation the policy guards", () => {
    const policy = Policy.of(aFile("policies", PASSWORD_POLICY_FILE, aPasswordPolicy()));

    const operation = policy.readOperation();

    expect(operation).toBe(PASSWORD_POLICY);
  });

  it("refuses a body the policy contract refuses", () => {
    const policy = Policy.of(
      aFile("policies", PASSWORD_POLICY_FILE, { operation: PASSWORD_POLICY }),
    );

    const error = thrownBy(() => {
      return policy.readOperation();
    });

    expect(error).toBeInstanceOf(BrokenFilesError);
    expect(error).toMatchObject({ problems: [{ path: PATH }] });
  });
});

describe("Policy.readConfig", () => {
  it("reads the rules without the $schema pointer", () => {
    const policy = Policy.of(
      aFile("policies", PASSWORD_POLICY_FILE, { $schema: POINTER, ...aPasswordPolicy() }),
    );

    const config = policy.readConfig();

    expect(config).toEqual({ min_length: 12 });
  });

  it("names the file and what the contract refuses in it", () => {
    const policy = Policy.of(
      aFile("policies", PASSWORD_POLICY_FILE, aPasswordPolicy({ min_length: 0 })),
    );

    const error = thrownBy(() => {
      return policy.readConfig();
    });

    expect(error).toBeInstanceOf(BrokenFilesError);
    expect(error).toMatchObject({
      message: expect.stringContaining(`${PATH}: config.min_length`),
    });
  });
});

describe("Policy.asRead", () => {
  it("marks a new policy as read", () => {
    const policy = Policy.create(aFile("policies", PASSWORD_POLICY_FILE, aPasswordPolicy()));

    const read = policy.asRead();

    expect(read.status).toBe("read");
  });
});

describe("Policy.problems", () => {
  it("finds nothing wrong with a policy named after its operation", () => {
    const policy = Policy.of(aFile("policies", PASSWORD_POLICY_FILE, aPasswordPolicy()));

    const problems = policy.problems({});

    expect(problems).toEqual([]);
  });

  it("finds nothing wrong with the editor's $schema pointer", () => {
    const policy = Policy.of(
      aFile("policies", PASSWORD_POLICY_FILE, { $schema: POINTER, ...aPasswordPolicy() }),
    );

    const problems = policy.problems({});

    expect(problems).toEqual([]);
  });

  it("names the file a policy must have when it has another", () => {
    const policy = Policy.of(aFile("policies", "password.json", aPasswordPolicy()));

    const problems = policy.problems({});

    expect(problems).toEqual([
      {
        severity: "error",
        rule: "contract/policy",
        file: `${CONFIG_DIRECTORIES.policies}/password.json`,
        message: `holds the ${PASSWORD_POLICY} policy, so it must be named ${PASSWORD_POLICY_FILE}`,
      },
    ]);
  });

  it("reports what the policy contract refuses, under contract/policy", () => {
    const policy = Policy.of(
      aFile("policies", PASSWORD_POLICY_FILE, aPasswordPolicy({ min_length: "twelve" })),
    );

    const problems = policy.problems({});

    expect(problems).toMatchObject([{ rule: "contract/policy" }]);
  });
});

describe("Policy.wireBody", () => {
  it("sends the operation and its rules without the $schema pointer", () => {
    const policy = Policy.of(
      aFile("policies", PASSWORD_POLICY_FILE, { $schema: POINTER, ...aPasswordPolicy() }),
    );

    const body = policy.wireBody(new MemoryStore());

    expect(body).toEqual(aPasswordPolicy());
  });

  it("sends a body the contract refuses as it is, for the deploy's checks to name", () => {
    const policy = Policy.of(
      aFile("policies", PASSWORD_POLICY_FILE, { operation: PASSWORD_POLICY }),
    );

    const body = policy.wireBody(new MemoryStore());

    expect(body).toEqual({ operation: PASSWORD_POLICY });
  });
});
