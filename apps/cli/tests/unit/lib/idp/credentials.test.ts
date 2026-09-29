import { describe, expect, it } from "vitest";

import { publishClientId, storeClientSecret, type SecretPublisher } from "../../../../src/lib/idp";

/** A publisher that records what it was handed, standing in for the API. */
function recorder(): { calls: Array<[string, string, boolean]>; publish: SecretPublisher } {
  const calls: Array<[string, string, boolean]> = [];
  return {
    calls,
    publish: async (name, value, { secret }) => {
      calls.push([name, value, secret]);
    },
  };
}

const NAME = "GOOGLE_CLIENT_SECRET";

describe("storeClientSecret", () => {
  it("publishes the secret to the project and writes nothing", async () => {
    // The project is the only place a credential is written: no runtime reads
    // it from the environment, and a copy in the working tree would be one
    // `git add -A` away from being published.
    const { calls, publish } = recorder();

    expect(await storeClientSecret({ name: NAME, value: "s3cret", publish })).toEqual({
      name: NAME,
      published: "stored",
    });
    expect(calls).toEqual([[NAME, "s3cret", true]]);
  });

  it("reports a refused publish instead of raising it", async () => {
    // The connection document is already on disk by now, and in `setup` the
    // whole Project is provisioned, so failing here would leave more to clean
    // up than `variables set` costs to run.
    const publish: SecretPublisher = async () => {
      throw new Error("403");
    };

    expect(await storeClientSecret({ name: NAME, value: "s3cret", publish })).toEqual({
      name: NAME,
      published: "failed",
    });
  });

  it("publishes nothing when no value is supplied", async () => {
    const { calls, publish } = recorder();

    expect(await storeClientSecret({ name: NAME, publish })).toEqual({
      name: NAME,
      published: "deferred",
    });
    expect(calls).toEqual([]);
  });

  it("defers when there is no project behind the run", async () => {
    expect(await storeClientSecret({ name: NAME, value: "s3cret" })).toEqual({
      name: NAME,
      published: "deferred",
    });
  });
});

describe("publishClientId", () => {
  it("publishes the id as an ordinary variable, not a secret", async () => {
    // The id travels in the browser's authorize URL, so it is public by
    // construction and storing it write-only would only cost the developer the
    // ability to read back what was configured.
    const { calls, publish } = recorder();

    expect(await publishClientId({ name: "GOOGLE_CLIENT_ID", value: "abc", publish })).toBe(
      "stored",
    );
    expect(calls).toEqual([["GOOGLE_CLIENT_ID", "abc", false]]);
  });
});
