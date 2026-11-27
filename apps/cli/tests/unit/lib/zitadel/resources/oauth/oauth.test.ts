import { describe, expect, it } from "vitest";

import { BrokenFile, CONFIG_DIRECTORIES, OAuthSettings } from "@/lib/zitadel";
import { MemoryStore } from "@tests/helpers/storage/backend/memory";
import { aFile, anOAuthSettings } from "@tests/helpers/config";

/**
 * The settings' file name under `.zitadel/oauth/`.
 */
const NAME = "oauth.json";

describe("OAuthSettings.read", () => {
  it("takes settings the OAuth contract takes as OAuth settings", () => {
    const reading = OAuthSettings.read(aFile("oauth", NAME, anOAuthSettings()));

    expect(reading).toBeInstanceOf(OAuthSettings);
  });

  it("takes settings the OAuth contract refuses as a broken file, under contract/oauth", () => {
    const reading = OAuthSettings.read(aFile("oauth", NAME, { enabled: "yes" }));

    expect(reading).toBeInstanceOf(BrokenFile);
    expect(reading).toMatchObject({ issues: [{ rule: "contract/oauth" }] });
  });
});

describe("OAuthSettings.enabled", () => {
  it("is the switch at the one path, with the editor's $schema pointer, marked as created", () => {
    const settings = OAuthSettings.enabled();

    expect(settings).toMatchObject({
      path: `${CONFIG_DIRECTORIES.oauth}/${NAME}`,
      body: { $schema: "../meta/oauth-settings.json", enabled: true },
      status: "created",
    });
  });
});

describe("OAuthSettings.withEnabled", () => {
  it("changes nothing when the switch is already so", () => {
    const settings = OAuthSettings.of(aFile("oauth", NAME, anOAuthSettings()));

    const edit = settings.withEnabled(true);

    expect(edit).toEqual({ document: settings, changed: false, skipped: [] });
  });

  it("sets the switch, keeping the rest of the body", () => {
    const settings = OAuthSettings.of(
      aFile("oauth", NAME, { $schema: "../meta/oauth-settings.json", enabled: false }),
    );

    const edit = settings.withEnabled(true);

    expect(edit.changed).toBe(true);
    expect(edit.document).toMatchObject({
      body: { $schema: "../meta/oauth-settings.json", enabled: true },
      status: "edited",
    });
  });
});

describe("OAuthSettings.toWireBody", () => {
  it("drops the editor-only $schema pointer", () => {
    const settings = OAuthSettings.of(
      aFile("oauth", NAME, { $schema: "../meta/oauth-settings.json", enabled: true }),
    );

    const body = settings.toWireBody(new MemoryStore());

    expect(body).toEqual({ enabled: true });
  });
});
