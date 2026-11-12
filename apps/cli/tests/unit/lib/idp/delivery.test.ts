import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CredentialDelivery,
  type DeliveryRun,
  type PublishedCredentials,
  type SecretPublisher,
} from "@/lib/idp";
import { takeReportedWarnings } from "@/lib/warnings";
import { Connection } from "@/lib/zitadel";
import { aGoogleConnection } from "@tests/helpers/config";
import { anAcmeSsoConnection } from "@tests/helpers/connections";
import { clientId, clientSecret, idVariable, secretVariable } from "@tests/helpers/idp-values";
import { aSuggest } from "@tests/helpers/suggest";

/**
 * Where the connections in these tests are written.
 */
const ACME_FILE = ".zitadel/idps/acme-sso.json";

/**
 * A connection reading both credentials from the variables its slug derives.
 */
const ACME = Connection.of({ path: ACME_FILE, body: anAcmeSsoConnection() });

/**
 * A connection holding its client id as a value and referencing its secret.
 */
const GOOGLE = Connection.of({
  path: ".zitadel/idps/google.json",
  body: aGoogleConnection(),
});

/**
 * A connection with no `oidc` block, so its slug derives the variables.
 */
const WITHOUT_OIDC = Connection.of({
  path: ACME_FILE,
  body: { slug: "acme-sso", protocol: "oidc", display_name: "Acme SSO" },
});

/**
 * Both credentials, as a run was given them.
 */
const GIVEN = { endpoints: undefined, clientId: clientId("abc"), secret: clientSecret("shh") };

/**
 * A delivery for a connection.
 *
 * @param connection - The connection.
 * @param reused - Whether it was already in the project.
 * @returns The delivery.
 */
function deliveryFor(connection: Connection, reused = false): CredentialDelivery {
  const run: DeliveryRun = {
    connection,
    reused,
    suggest: aSuggest(),
  };
  return new CredentialDelivery(run);
}

beforeEach(() => {
  takeReportedWarnings();
});

describe("CredentialDelivery.names", () => {
  it("derives the variables from the slug when the connection has no oidc block", () => {
    expect(deliveryFor(WITHOUT_OIDC).names).toEqual({
      clientId: idVariable("acme-sso"),
      clientSecret: secretVariable("acme-sso"),
    });
  });

  it("reads the variables the connection references", () => {
    expect(deliveryFor(ACME).names).toEqual({
      clientId: idVariable("acme-sso"),
      clientSecret: secretVariable("acme-sso"),
    });
  });

  it("names no variable for a client id the connection holds as a value", () => {
    expect(deliveryFor(GOOGLE).names).toEqual({
      clientId: undefined,
      clientSecret: secretVariable("google"),
    });
  });
});

describe("CredentialDelivery.publish", () => {
  it("stores the client id before the secret", async () => {
    const order: string[] = [];
    const publisher = vi.fn<SecretPublisher>(async (name) => {
      order.push(name);
    });

    await deliveryFor(ACME).publish(GIVEN, publisher);

    expect(order).toEqual([idVariable("acme-sso"), secretVariable("acme-sso")]);
  });

  it("stores the secret as a secret and the client id as a plain variable", async () => {
    const publisher = vi.fn<SecretPublisher>(async () => {});

    await deliveryFor(ACME).publish(GIVEN, publisher);

    expect(publisher.mock.calls.map((call) => call[2])).toEqual([
      { secret: false },
      { secret: true },
    ]);
  });

  it("reports both stored", async () => {
    const published = await deliveryFor(ACME).publish(GIVEN, async () => {});

    expect(published).toEqual({
      clientId: "stored",
      secret: { name: secretVariable("acme-sso"), published: "stored" },
    });
  });

  it("defers both when there is no project to publish to", async () => {
    const published = await deliveryFor(ACME).publish(GIVEN, undefined);

    expect(published).toEqual({
      clientId: "deferred",
      secret: { name: secretVariable("acme-sso"), published: "deferred" },
    });
  });

  it("reports a refused publish as failed, and warns how to retry", async () => {
    const published = await deliveryFor(ACME).publish(GIVEN, async () => {
      throw new Error("down");
    });

    expect(published.secret).toEqual({ name: secretVariable("acme-sso"), published: "failed" });
    expect(takeReportedWarnings()).toEqual([
      expect.stringContaining("ACME_SSO_CLIENT_ID could not be published"),
      expect.stringContaining("ACME_SSO_CLIENT_SECRET could not be published"),
    ]);
  });

  it("sends nothing for a credential that was not given", async () => {
    const publisher = vi.fn<SecretPublisher>(async () => {});

    const published = await deliveryFor(ACME, true).publish(
      { endpoints: undefined, clientId: undefined, secret: undefined },
      publisher,
    );

    expect(publisher).not.toHaveBeenCalled();
    expect(published).toEqual({ clientId: undefined, secret: undefined });
  });

  it("says a client id held as a value was not published, and does not send it", async () => {
    const publisher = vi.fn<SecretPublisher>(async () => {});

    const published = await deliveryFor(GOOGLE).publish(GIVEN, publisher);

    expect(published.clientId).toBeUndefined();
    expect(publisher.mock.calls.map((call) => call[0])).toEqual([secretVariable("google")]);
    expect(takeReportedWarnings()).toEqual([
      expect.stringContaining(".zitadel/idps/google.json holds its client id directly"),
    ]);
  });

  it("warns of nothing on a reused connection that was given nothing", async () => {
    await deliveryFor(ACME, true).publish(
      { endpoints: undefined, clientId: undefined, secret: undefined },
      async () => {},
    );

    expect(takeReportedWarnings()).toEqual([]);
  });
});

describe("CredentialDelivery.areStored", () => {
  const stored = { name: secretVariable("acme-sso"), published: "stored" } as const;

  it.each<[string, PublishedCredentials, boolean]>([
    ["both stored", { clientId: "stored", secret: stored }, true],
    ["the client id not sent", { clientId: undefined, secret: stored }, true],
    ["the client id deferred", { clientId: "deferred", secret: stored }, false],
    ["the client id failed", { clientId: "failed", secret: stored }, false],
    [
      "the secret failed",
      { clientId: "stored", secret: { ...stored, published: "failed" } },
      false,
    ],
    ["the secret not sent", { clientId: "stored", secret: undefined }, false],
  ])("is decided with %s", (_name, published, expected) => {
    expect(deliveryFor(ACME).areStored(published)).toBe(expected);
  });
});

describe("CredentialDelivery.unpublishedOf", () => {
  it("lists nothing when the project holds everything", () => {
    const published: PublishedCredentials = {
      clientId: "stored",
      secret: { name: secretVariable("acme-sso"), published: "stored" },
    };

    expect(deliveryFor(ACME).unpublishedOf(published)).toEqual([]);
  });

  it("lists each credential that did not arrive", () => {
    const published: PublishedCredentials = {
      clientId: "failed",
      secret: { name: secretVariable("acme-sso"), published: "deferred" },
    };

    expect(deliveryFor(ACME).unpublishedOf(published)).toEqual([
      { name: idVariable("acme-sso"), secret: false },
      { name: secretVariable("acme-sso"), secret: true },
    ]);
  });

  it("leaves out a credential nothing was sent for", () => {
    const published: PublishedCredentials = { clientId: undefined, secret: undefined };

    expect(deliveryFor(ACME).unpublishedOf(published)).toEqual([]);
  });

  it("leaves out a client id the connection holds as a value", () => {
    const published: PublishedCredentials = {
      clientId: "failed",
      secret: { name: secretVariable("google"), published: "failed" },
    };

    expect(deliveryFor(GOOGLE).unpublishedOf(published)).toEqual([
      { name: secretVariable("google"), secret: true },
    ]);
  });
});
