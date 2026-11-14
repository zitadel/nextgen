import { describe, expect, it, vi } from "vitest";

import { publishClientId, type SecretPublisher, storeClientSecret, unpublished } from "@/lib/idp";
import { clientId, clientSecret, idVariable, secretVariable } from "@tests/helpers/idp-values";

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
    expect(
      unpublished([{ name: idVariable("google"), secret: false, published: "deferred" }]),
    ).toHaveLength(1);
  });

  it("skips a credential this run never had", () => {
    expect(unpublished([{ name: undefined, secret: false, published: "failed" }])).toEqual([]);
    expect(
      unpublished([{ name: idVariable("google"), secret: false, published: undefined }]),
    ).toEqual([]);
  });
});

describe("publishing a credential", () => {
  it("stores the client id as a plain variable and the secret as a secret", async () => {
    const publisher = vi.fn<SecretPublisher>(async () => {});

    await publishClientId({
      name: idVariable("acme-sso"),
      value: clientId("abc"),
      publish: publisher,
    });
    await storeClientSecret({
      name: secretVariable("acme-sso"),
      value: clientSecret("shh"),
      publish: publisher,
    });

    expect(publisher.mock.calls.map((call) => call[0])).toEqual([
      idVariable("acme-sso"),
      secretVariable("acme-sso"),
    ]);
    expect(publisher.mock.calls.map((call) => call[2])).toEqual([
      { secret: false },
      { secret: true },
    ]);
  });

  it("reports both stored", async () => {
    const stored = async () => {};

    expect(
      await publishClientId({
        name: idVariable("acme-sso"),
        value: clientId("abc"),
        publish: stored,
      }),
    ).toBe("stored");
    expect(
      await storeClientSecret({
        name: secretVariable("acme-sso"),
        value: clientSecret("shh"),
        publish: stored,
      }),
    ).toEqual({ name: secretVariable("acme-sso"), published: "stored" });
  });

  it("defers both when there is no project to publish to", async () => {
    expect(await publishClientId({ name: idVariable("acme-sso"), value: clientId("abc") })).toBe(
      "deferred",
    );
    expect(
      await storeClientSecret({
        name: secretVariable("acme-sso"),
        value: clientSecret("shh"),
      }),
    ).toEqual({ name: secretVariable("acme-sso"), published: "deferred" });
  });

  it("defers a secret that was not given, without calling the publisher", async () => {
    const publisher = vi.fn<SecretPublisher>(async () => {});

    expect(
      await storeClientSecret({ name: secretVariable("acme-sso"), publish: publisher }),
    ).toEqual({ name: secretVariable("acme-sso"), published: "deferred" });
    expect(publisher).not.toHaveBeenCalled();
  });

  it("reports a refused publish as failed instead of raising it", async () => {
    const refused = async () => {
      throw new Error("down");
    };

    expect(
      await publishClientId({
        name: idVariable("acme-sso"),
        value: clientId("abc"),
        publish: refused,
      }),
    ).toBe("failed");
    expect(
      await storeClientSecret({
        name: secretVariable("acme-sso"),
        value: clientSecret("shh"),
        publish: refused,
      }),
    ).toEqual({ name: secretVariable("acme-sso"), published: "failed" });
  });
});
