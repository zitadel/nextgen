import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

const PREVIEW_PATTERN = "https://*-acme.vercel.app";
const PREVIEW_URL = "https://x-acme.vercel.app";

/** Arranges a project with one live preview deployed to {@link PREVIEW_URL}. */
async function anAppWithAPreview() {
  const app = await aSetUpApp();
  await app.addOrigin(PREVIEW_PATTERN, "preview");
  await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);
  return app;
}

describe("preview rm", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force", "--json"]);

        expect(result).toFail();
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force", "--json"]);

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("removes a live preview, so it stops being listed", async () => {
        const app = await anAppWithAPreview();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force", "--json"]);

        expect(result).toSucceed();
        const listed = await app.run(["preview", "list", "--json"]);
        expect(app.envelopeOf<{ items: unknown[] }>(listed).data.items).toEqual([]);
      });

      it("succeeds when the preview is already gone", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force", "--json"]);

        expect(result).toSucceed();
      });

      it("requires --force when non-interactive", async () => {
        const app = await anAppWithAPreview();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--non-interactive", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("rendered for a terminal", () => {
      it("says what it stopped serving", async () => {
        const app = await anAppWithAPreview();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force"]);

        expect(result).toPrint(`Stopped serving ${PREVIEW_URL}`);
      });
    });
  });
});
