import { describe, expect, it } from "vitest";

import { idVariable, secretVariable } from "@tests/helpers/idp-values";
import { unpublished } from "@/lib/idp";

describe("the credentials a recovery is for", () => {
  it("lists each credential that did not land, with whether it is a secret", () => {
    expect(
      unpublished([
        { name: idVariable("google"), secret: false, published: "failed" },
        { name: secretVariable("google"), secret: true, published: "deferred" },
        { name: secretVariable("acme"), secret: true, published: "stored" },
      ]),
    ).toEqual([
      { name: idVariable("google"), secret: false },
      { name: secretVariable("google"), secret: true },
    ]);
  });

  it("says nothing when the project received everything", () => {
    expect(
      unpublished([
        { name: idVariable("google"), secret: false, published: "stored" },
        { name: secretVariable("google"), secret: true, published: "stored" },
      ]),
    ).toEqual([]);
  });

  it("covers a deferred publish, not just a failed one", () => {
    // Deferred means the value never reached the project either; the button
    // fails at token exchange just the same.
    expect(
      unpublished([{ name: idVariable("google"), secret: false, published: "deferred" }]),
    ).toHaveLength(1);
  });

  it("skips a credential this run never had", () => {
    // No provider was enabled, or no secret was supplied: there is nothing to
    // republish and a command naming an empty variable would be noise.
    expect(unpublished([{ name: undefined, secret: false, published: "failed" }])).toEqual([]);
    expect(
      unpublished([{ name: idVariable("google"), secret: false, published: undefined }]),
    ).toEqual([]);
  });
});
