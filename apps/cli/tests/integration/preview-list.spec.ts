import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";
import { CREDENTIALS, PREVIEW_CREDENTIAL } from "../../src/lib/oclif";

const platform = usePlatformMock();

const PREVIEW_PATTERN = "https://*-acme.vercel.app";
const PREVIEW_URL = "https://x-acme.vercel.app";

type Listed = { items: { origin: string }[]; count: number; next_page_token: string | null };

/** Arranges a project with one live preview deployed to {@link PREVIEW_URL}. */
async function anAppWithAPreview() {
  const app = await aSetUpApp();
  await app.addOrigin(PREVIEW_PATTERN, "preview");
  await app.previewData(PREVIEW_URL);
  return app;
}

/** Arranges a project with two live previews. */
async function anAppWithTwoPreviews() {
  const app = await anAppWithAPreview();
  await app.previewData("https://y-acme.vercel.app");
  return app;
}

describe("preview list", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["preview", "list", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["preview", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("fails naming the preview credential when it is not set", async () => {
        const app = await anApp();
        await app.bindEnvironment("preview", {
          ZITADEL_PROJECT_ID: "proj_preview",
          ...(PREVIEW_CREDENTIAL === "project"
            ? { ZITADEL_PREVIEW_TOKEN: "pt" }
            : { ZITADEL_PROJECT_SECRET: "sk" }),
        });

        const result = await app.run(["preview", "list", "--env", "preview", "--json"]);

        expect(result).toSay(CREDENTIALS[PREVIEW_CREDENTIAL]);
      });

      it("fails rather than reading every page when one comes back empty", async () => {
        const app = await anAppWithTwoPreviews();
        platform.answersTheNextListWithNothing("previews");

        expect(await app.run(["preview", "list", "--limit", "1", "--json"])).toFailWith(
          "E_VALIDATION",
        );
      });

      it("is empty on a project with no previews", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "list", "--json"]);

        expect(app.envelopeOf<Listed>(result).data.items).toEqual([]);
      });

      it("shows a preview that was deployed", async () => {
        const app = await anAppWithAPreview();

        const result = await app.run(["preview", "list", "--json"]);

        expect(app.envelopeOf<Listed>(result).data.items.map((preview) => preview.origin)).toEqual([
          PREVIEW_URL,
        ]);
      });

      it("counts the previews it lists", async () => {
        const app = await anAppWithAPreview();

        const result = await app.run(["preview", "list", "--all", "--json"]);

        expect(app.envelopeOf<Listed>(result).data.count).toBe(1);
      });

      it("reports no continuation token once --all has drained every page", async () => {
        const app = await anAppWithTwoPreviews();

        const result = await app.run(["preview", "list", "--all", "--limit", "1", "--json"]);

        expect(app.envelopeOf<Listed>(result).data.next_page_token).toBeNull();
      });

      it("lists every preview with --all across pages", async () => {
        const app = await anAppWithTwoPreviews();

        const result = await app.run(["preview", "list", "--all", "--limit", "1", "--json"]);

        expect(app.envelopeOf<Listed>(result).data.count).toBe(2);
      });

      it("suggests the next page, repeating the limit", async () => {
        const app = await anAppWithTwoPreviews();

        const result = await app.run(["preview", "list", "--limit", "1", "--json"]);

        expect(result).toSuggest("preview list --limit 1 --page-token");
      });
    });
  });
});
