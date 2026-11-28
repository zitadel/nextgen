import { describe, expect, it } from "vitest";

import { Application, BrokenFile, CONFIG_DIRECTORIES } from "@/lib/zitadel";
import { MemoryStore } from "@tests/helpers/storage/backend/memory";
import { aFile, anApplication } from "@tests/helpers/config";

/**
 * The application's file name under `.zitadel/applications/`.
 */
const NAME = "shop.json";

/**
 * Where the application in these tests sits.
 */
const PATH = `${CONFIG_DIRECTORIES.applications}/${NAME}`;

describe("Application.read", () => {
  it("takes a declared application as an application", () => {
    const reading = Application.read(aFile("applications", NAME, anApplication()));

    expect(reading).toBeInstanceOf(Application);
  });

  it.each([
    ["a client without a client_id", { client_id: undefined }, "clients.0.client_id"],
    ["a confidential client without a secret", { secret: undefined }, "clients.0.secret"],
    ["a secret held as a value", { secret: "s3cr3t" }, "clients.0.secret"],
    ["a key the client does not have", { redirect_uri: "https://x.test/cb" }, "clients.0"],
  ])("refuses %s under contract/application, at the field", (_what, client, where) => {
    const reading = Application.read(aFile("applications", NAME, anApplication(client)));

    expect(reading).toBeInstanceOf(BrokenFile);
    expect((reading as BrokenFile).issues).toEqual([
      expect.objectContaining({
        rule: "contract/application",
        file: PATH,
        message: expect.stringMatching(new RegExp(`^${where.replaceAll(".", "\\.")} `)),
      }),
    ]);
  });
});

describe("Application.read of a client with several problems", () => {
  it("reports a missing client_id and secret beside the client's other refusals", () => {
    const body = { slug: "shop", name: "Shop", clients: [{ slug: "web" }] };

    const reading = Application.read(aFile("applications", NAME, body));

    const messages = (reading as BrokenFile).issues.map((issue) => {
      return issue.message;
    });
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^clients\.0\.type /),
        expect.stringMatching(/^clients\.0\.client_id is required/),
        expect.stringMatching(/^clients\.0\.secret is required/),
      ]),
    );
  });
});

describe("Application.secretVariables", () => {
  it("names each client's secret variable", () => {
    const application = Application.of(aFile("applications", NAME, anApplication()));

    expect(application.secretVariables).toEqual([
      { client: "web", variable: "SHOP_WEB_CLIENT_SECRET" },
    ]);
  });
});

describe("Application.toWireBody", () => {
  it("sends the document without its $schema pointer", () => {
    const application = Application.of(
      aFile("applications", NAME, { $schema: "../meta/application.json", ...anApplication() }),
    );

    expect(application.toWireBody(new MemoryStore())).toEqual(anApplication());
  });
});
