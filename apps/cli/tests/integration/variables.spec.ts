import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("variables set", () => {
  describe("against an unavailable platform", () => {
    it("fails when the platform is unavailable", async () => {
      const app = await aSetUpApp();
      platform.isUnavailable();

      const result = await app.setVariable("FOO", "bar");

      expect(result).toFailWith("E_NETWORK");
    });
  });

  describe("against the platform", () => {
    describe("--json", () => {
      it("enters a variable on the project", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariable("FOO", "bar");

        expect(result).toSucceed();
      });

      it("reports the name it entered", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariable("FOO", "bar");

        expect(app.envelopeOf<{ name: string }>(result).data.name).toBe("FOO");
      });

      it("says a secret is held as a secret", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariable("TOKEN", "s3cret", { secret: true });

        expect(app.envelopeOf<{ secret: boolean }>(result).data.secret).toBe(true);
      });
    });
  });
});

describe("variables list", () => {
  describe("against an unavailable platform", () => {
    it("fails", async () => {
      const app = await aSetUpApp();
      platform.isUnavailable();

      const result = await app.run(["variables", "list", "--project-level", "--json"]);

      expect(result).toFailWith("E_NETWORK");
    });
  });

  describe("against the platform", () => {
    describe("--json", () => {
      it("shows a variable that was entered", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const listed = await app.projectVariables();

        expect(listed).toEqual(expect.arrayContaining([expect.objectContaining({ name: "FOO" })]));
      });

      it("carries a plain value", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const listed = await app.projectVariables();

        expect(listed.find((variable) => variable.name === "FOO")?.value).toBe("bar");
      });

      it("withholds a secret's value", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();

        const listed = await app.projectVariables();

        const held = listed.find((variable) => variable.name === "TOKEN");
        expect(held).toMatchObject({ secret: true });
        expect(held).not.toHaveProperty("value");
      });
    });
  });
});

describe("variables get", () => {
  describe("against an unavailable platform", () => {
    it("fails", async () => {
      const app = await aSetUpApp();
      platform.isUnavailable();

      const result = await app.getVariable("FOO");

      expect(result).toFailWith("E_NETWORK");
    });
  });

  describe("against the platform", () => {
    describe("--json", () => {
      it("reads back a value that was entered", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.getVariable("FOO");

        expect(result).toSucceed();
        expect(app.envelopeOf<{ value: string }>(result).data.value).toBe("bar");
      });

      it("refuses a name the project does not hold", async () => {
        const app = await aSetUpApp();

        const result = await app.getVariable("NOT_THERE");

        expect(result).toFail();
      });

      it("withholds a secret's value", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();

        const result = await app.getVariable("TOKEN");

        expect(result).toSucceed();
        expect(app.envelopeOf<{ secret: boolean }>(result).data).toMatchObject({ secret: true });
        expect(app.envelopeOf<Record<string, unknown>>(result).data).not.toHaveProperty("value");
      });
    });
  });
});

describe("variables delete", () => {
  describe("against an unavailable platform", () => {
    it("fails", async () => {
      const app = await aSetUpApp();
      platform.isUnavailable();

      const result = await app.deleteVariable("FOO");

      expect(result).toFailWith("E_NETWORK");
    });
  });

  describe("against the platform", () => {
    describe("--json", () => {
      it("removes a variable that was entered", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.deleteVariable("FOO");

        expect(result).toSucceed();
      });

      it("leaves the project without that variable", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        expect(await app.deleteVariable("FOO")).toSucceed();

        expect(await app.projectVariables()).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ name: "FOO" })]),
        );
      });

      it("refuses a name the project does not hold", async () => {
        const app = await aSetUpApp();

        const result = await app.deleteVariable("NOT_THERE");

        expect(result).toFail();
      });
    });
  });
});
