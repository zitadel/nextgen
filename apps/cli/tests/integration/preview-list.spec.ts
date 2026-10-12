import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

const PREVIEW_PATTERN = "https://*-acme.vercel.app";
const PREVIEW_URL = "https://x-acme.vercel.app";

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
      it("is empty on a project with no previews", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "list", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ previews: unknown[] }>(result).data.previews).toEqual([]);
      });

      it("shows a preview that was deployed", async () => {
        const app = await aSetUpApp();
        await app.addOrigin(PREVIEW_PATTERN, "preview");
        await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        const result = await app.run(["preview", "list", "--json"]);

        expect(result).toSucceed();
        expect(
          app.envelopeOf<{ previews: { origin: string }[] }>(result).data.previews.map(
            (preview) => preview.origin,
          ),
        ).toEqual([PREVIEW_URL]);
      });
    });
  });
});
