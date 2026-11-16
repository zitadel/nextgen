import { describe, expect, it } from "vitest";

import { assertNoSecretEchoed, secretsIn } from "@tests/helpers/argv-secrets";
import { thrownBy } from "@tests/helpers/thrown-value";

describe("secretsIn", () => {
  it.each([
    ["a flag named like a credential", ["--client-secret", "hunter2hunter2"], ["hunter2hunter2"]],
    ["the same flag given with =", ["--client-secret=hunter2hunter2"], ["hunter2hunter2"]],
    [
      "a --set assignment to a credential",
      ["--set", "attributes.password=hunter2hunter2"],
      ["hunter2hunter2"],
    ],
    [
      "a --field assignment of JSON to a credential",
      ["-F", "api_key:=hunter2hunter2"],
      ["hunter2hunter2"],
    ],
    [
      "a --data document",
      ["--data", '{"idp":{"client_secret":"hunter2hunter2"}}'],
      ["hunter2hunter2"],
    ],
  ])("finds the secret in %s", (_form, args, found) => {
    expect(secretsIn(args)).toEqual(found);
  });

  it.each([
    ["a flag that holds no credential", ["--message", "hunter2hunter2"]],
    ["a --set assignment to anything else", ["--set", "display_name=hunter2hunter2"]],
    ["a flag that names where the secret is", ["--client-secret-file", "./secret.txt"]],
    ["a placeholder", ["--client-secret", "<client-secret>"]],
    ["a platform variable reference", ["--client-secret", "${{ GOOGLE_SECRET }}"]],
    ["a value too short to be one", ["--password", "true"]],
    ["a --data document with no credential", ["--data", '{"name":"hunter2hunter2"}']],
    ["a --data value that is no document", ["--data", "hunter2hunter2"]],
    ["a flag with no value", ["--client-secret", "--json"]],
  ])("finds none in %s", (_form, args) => {
    expect(secretsIn(args)).toEqual([]);
  });
});

describe("assertNoSecretEchoed", () => {
  it("passes a run that printed none of its secrets", () => {
    const thrown = thrownBy(() => {
      assertNoSecretEchoed({ stdout: "{}", stderr: "" }, ["--password", "hunter2hunter2"]);
    });

    expect(thrown).toBeUndefined();
  });

  it.each(["stdout", "stderr"] as const)("fails a run that printed one on %s", (stream) => {
    const result = { stdout: "", stderr: "", [stream]: "retry: --password hunter2hunter2" };

    const thrown = thrownBy(() => {
      assertNoSecretEchoed(result, ["--password", "hunter2hunter2"]);
    });

    expect(thrown).toBeInstanceOf(Error);
  });
});
