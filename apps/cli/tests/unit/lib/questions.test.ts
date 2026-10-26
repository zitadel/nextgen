import { describe, expect, it } from "vitest";

import { clientIdQuestion, clientSecretQuestion } from "../../../src/lib/questions";

describe("clientIdQuestion", () => {
  it("asks which client ID, naming the provider's OAuth app", () => {
    expect(clientIdQuestion("Google")).toMatchObject({
      kind: "text",
      name: "client id for Google",
      message: "What is the client ID of your Google OAuth app?",
    });
  });
});

describe("clientSecretQuestion", () => {
  it("says where the secret will be stored when the variable is known", () => {
    expect(
      clientSecretQuestion({ provider: "Google", variable: "GOOGLE_CLIENT_SECRET" }),
    ).toMatchObject({
      kind: "secret",
      name: "client secret for GOOGLE_CLIENT_SECRET",
      message:
        "What is the client secret of your Google OAuth app? It will be stored on the project as GOOGLE_CLIENT_SECRET.",
    });
  });

  it("asks without a storage note when there is no variable yet", () => {
    expect(clientSecretQuestion({ provider: "Acme SSO" })).toMatchObject({
      kind: "secret",
      name: "client secret",
      message: "What is the client secret of your Acme SSO OAuth app?",
    });
  });
});
