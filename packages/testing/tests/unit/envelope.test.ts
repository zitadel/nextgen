import { describe, expect, it } from "vitest";

import { describeEnvelopeError, type CliEnvelope } from "../../src/envelope";
import { bootLocalServer } from "../../src/lifecycle";
import { fakeCliBin } from "./helpers/fake-cli";

const errorEnvelope = (overrides: Partial<CliEnvelope<unknown>> = {}): CliEnvelope<unknown> => ({
  status: "error",
  code: "E_VALIDATION",
  message: "Zitadel server npm package is not available",
  hint: "Reinstall @zitadel/cli so npm can install @zitadel/server and its platform package.",
  next_commands: ["npm install @zitadel/cli@alpha"],
  data: undefined,
  ...overrides,
});

describe("describeEnvelopeError", () => {
  it("renders code, message, hint, and next commands", () => {
    expect(describeEnvelopeError(errorEnvelope())).toBe(
      [
        "E_VALIDATION: Zitadel server npm package is not available",
        "hint: Reinstall @zitadel/cli so npm can install @zitadel/server and its platform package.",
        "next: npm install @zitadel/cli@alpha",
      ].join("\n"),
    );
  });

  it("omits absent fields and returns undefined without a message", () => {
    expect(describeEnvelopeError(errorEnvelope({ code: undefined, hint: undefined }))).toBe(
      "Zitadel server npm package is not available\nnext: npm install @zitadel/cli@alpha",
    );
    expect(describeEnvelopeError({ status: "ok", data: undefined })).toBeUndefined();
  });
});

describe("bootLocalServer failure surfacing", () => {
  it("surfaces the error envelope's hint and next commands over raw tails", async () => {
    const fake = await fakeCliBin({
      startExitCode: 1,
      startStdout: JSON.stringify(errorEnvelope()),
    });
    await expect(bootLocalServer({ cliBin: fake.binPath, port: 18099 })).rejects.toThrow(
      /hint: Reinstall @zitadel\/cli[\s\S]*next: npm install @zitadel\/cli@alpha/,
    );
  });
});
