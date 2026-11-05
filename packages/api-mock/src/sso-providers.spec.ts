import type { CreateFlow201 } from "@zitadel/api/generated/model";
import { afterEach, describe, expect, it } from "vitest";

import { applySsoProviders, clearSsoProviders, withSsoProviders } from "./sso-providers.js";

const google = { id: "google", name: "Google", template: "google" };

const flowAt = (name: string, descriptionKey?: string) =>
  ({
    step: { name, texts: { title_key: `${name}.title`, description_key: descriptionKey } },
  }) as unknown as CreateFlow201;

describe("withSsoProviders", () => {
  afterEach(clearSsoProviders);

  it("asks for the description a step with providers has of its own", () => {
    applySsoProviders([google]);

    const step = withSsoProviders(flowAt("password", "password.description")).step;

    expect(step.texts?.description_key).toBe("password.description.sso");
  });

  it("keeps the plain description on a step that offers no providers", () => {
    applySsoProviders([google]);

    const step = withSsoProviders(flowAt("passkey-login", "passkey-login.description")).step;

    expect(step.texts?.description_key).toBe("passkey-login.description");
  });

  it("keeps the plain description when no provider is applied", () => {
    const step = withSsoProviders(flowAt("password", "password.description")).step;

    expect(step.texts?.description_key).toBe("password.description");
  });

  it("asks for the provider description once, however often it is applied", () => {
    applySsoProviders([google]);

    const step = withSsoProviders(
      withSsoProviders(flowAt("password", "password.description")),
    ).step;

    expect(step.texts?.description_key).toBe("password.description.sso");
  });

  it("leaves an empty description alone", () => {
    applySsoProviders([google]);

    const step = withSsoProviders(flowAt("password", "")).step;

    expect(step.texts?.description_key).toBe("");
  });

  it("leaves a step that has no description alone", () => {
    applySsoProviders([google]);

    const step = withSsoProviders(flowAt("identifier")).step;

    expect(step.texts?.description_key).toBeUndefined();
  });
});
