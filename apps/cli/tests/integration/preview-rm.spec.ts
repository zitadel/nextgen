import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp } from "@tests/helpers/project";
import { CREDENTIALS, PREVIEW_CREDENTIAL } from "@/lib/oclif";

const SERVERS = [
  ["a remote server", "http://mock.zitadel.test"],
  ["a local server", "http://localhost:8112"],
];

const platform = usePlatformMock();

const PREVIEW_PATTERN = "https://*-acme.vercel.app";
const PREVIEW_URL = "https://x-acme.vercel.app";

/** Arranges a project with one live preview deployed to {@link PREVIEW_URL}. */
async function anAppWithAPreview() {
  const app = await aSetUpApp();
  await app.addOrigin(PREVIEW_PATTERN, "preview");
  await app.previewData(PREVIEW_URL);
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
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      const args = ["preview", "rm", "https://wiped\u001b[2J.preview.example.com", "--force"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("fails naming the preview credential when it is not set", async () => {
        const app = await anApp();
        await app.bindEnvironment("preview", {
          ZITADEL_PROJECT_ID: "proj_preview",
          ...(PREVIEW_CREDENTIAL === "project"
            ? { ZITADEL_PREVIEW_TOKEN: "pt" }
            : { ZITADEL_PROJECT_SECRET: "sk" }),
        });

        const result = await app.run([
          "preview",
          "rm",
          PREVIEW_URL,
          "--env",
          "preview",
          "--force",
          "--json",
        ]);

        expect(result).toSay(CREDENTIALS[PREVIEW_CREDENTIAL]);
      });

      it("removes a preview given with a trailing slash", async () => {
        const app = await anAppWithAPreview();

        await app.run(["preview", "rm", `${PREVIEW_URL}/`, "--force", "--json"]);

        const listed = await app.run(["preview", "list", "--json"]);
        expect(app.envelopeOf<{ items: unknown[] }>(listed).data.items).toEqual([]);
      });

      it("answers a dry run without a preview token", async () => {
        const app = await anApp();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--dry-run", "--json"]);

        expect(result).toSucceed();
      });

      it("removes a live preview, so it stops being listed", async () => {
        const app = await anAppWithAPreview();

        await app.run(["preview", "rm", PREVIEW_URL, "--force", "--json"]);

        const listed = await app.run(["preview", "list", "--json"]);
        expect(app.envelopeOf<{ items: unknown[] }>(listed).data.items).toEqual([]);
      });

      it("is skipped when the URL is not a live preview", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force", "--json"]);

        expect(result).toBeSkipped();
      });

      it("suggests listing the live previews when the URL is not one", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force", "--json"]);

        expect(result).toSuggest("preview list");
      });

      describe("without --force when no one can be asked", () => {
        it("is refused", async () => {
          const app = await anAppWithAPreview();

          const result = await app.run(["preview", "rm", PREVIEW_URL, "--json"]);

          expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
        });

        it("says to pass --force", async () => {
          const app = await anAppWithAPreview();

          const result = await app.run(["preview", "rm", PREVIEW_URL, "--json"]);

          expect(result).toHintAt("--force");
        });

        it.each(SERVERS)(
          "names the project and the server it would act on, for %s",
          async (_kind, server) => {
            const app = await anAppWithAPreview();

            const result = await app.runWithoutServer([
              "preview",
              "rm",
              PREVIEW_URL,
              "--server",
              server,
              "--json",
            ]);

            expect(result).toHintAt(await app.projectPlace(server));
          },
        );

        it("suggests running it again with --force", async () => {
          const app = await anAppWithAPreview();

          const result = await app.run(["preview", "rm", PREVIEW_URL, "--json"]);

          expect(result).toSuggestExactly(app.againAsRun(`preview rm ${PREVIEW_URL} --force`));
        });

        it("removes nothing", async () => {
          const app = await anAppWithAPreview();

          await app.run(["preview", "rm", PREVIEW_URL, "--json"]);

          const listed = await app.run(["preview", "list", "--json"]);
          expect(app.envelopeOf<{ items: unknown[] }>(listed).data.items).not.toEqual([]);
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says what it stopped serving", async () => {
        const app = await anAppWithAPreview();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force"]);

        expect(result).toPrint(`Stopped serving ${PREVIEW_URL}`);
      });

      it("says nothing was removed when the URL is not a live preview", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force"]);

        expect(result).toPrint("is not a live preview of the project; nothing was removed");
      });
    });
  });
});
