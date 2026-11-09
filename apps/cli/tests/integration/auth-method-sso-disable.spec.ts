import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, type CustomConnection, type ScaffoldedApp } from "@tests/helpers/project";

const platform = usePlatformMock();

/**
 * The catalog provider the project serves.
 */
const GOOGLE = "google";

/**
 * Google's client id and secret.
 */
const CREDENTIALS = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

/**
 * A connection the catalog does not list, described by the developer.
 */
const ACME: CustomConnection = {
  slug: "acme-sso",
  displayName: "Acme SSO",
  issuer: "https://sso.acme.example",
};

/**
 * The custom connection's client id and secret.
 */
const ACME_CREDENTIALS = { clientId: "acme-client-id", secret: "acme-client-secret" };

/**
 * A provider neither the catalog nor a connection names.
 */
const UNKNOWN_PROVIDER = "gogle";

/**
 * What a project's files look like after a command that wrote nothing.
 */
const NO_CHANGES = { added: [], modified: [], removed: [] };

/**
 * A set-up project serving Google, deployed.
 *
 * @returns The project.
 */
async function anAppServingGoogle(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  await app.hasEnabledSso(GOOGLE, CREDENTIALS);
  await app.publishData();
  return app;
}

/**
 * A set-up project serving a custom connection, deployed.
 *
 * @returns The project.
 */
async function anAppServingAcme(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  await app.hasEnabledCustomSso(ACME, ACME_CREDENTIALS);
  await app.publishData();
  return app;
}

describe("auth-method sso disable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still removes the provider", async () => {
        const app = await anAppServingGoogle();
        platform.isNotZitadel();

        const result = await app.disableSso(GOOGLE);

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still removes the provider", async () => {
        const app = await anAppServingGoogle();
        platform.isUnavailable();

        const result = await app.disableSso(GOOGLE);

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["auth-method", "sso", "disable", "--provider", GOOGLE, "--force"];

      await app.inEveryRendering((how) => {
        return app.run(how.json ? [...args, "--json"] : args, how.env);
      });
    });

    describe("--json", () => {
      it("removes the provider", async () => {
        const app = await anAppServingGoogle();

        const result = await app.disableSso(GOOGLE);

        expect(result).toSucceed();
      });

      it("leaves the change for deploy to publish", async () => {
        const app = await anAppServingGoogle();

        await app.disableSso(GOOGLE);

        expect(await app.publishedAuthMethods()).toHaveProperty("sso.enabled", true);
      });

      describe("removing the last way to sign in without --force when no one can be asked", () => {
        it("is refused", async () => {
          const app = await anAppServingGoogle();
          await app.signsInOnlyWithSso(GOOGLE);

          const result = await app.disableSso(GOOGLE);

          expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
        });

        it("says to pass --force", async () => {
          const app = await anAppServingGoogle();
          await app.signsInOnlyWithSso(GOOGLE);

          const result = await app.disableSso(GOOGLE);

          expect(result).toHintAt("--force");
        });

        it("suggests running it again with --force", async () => {
          const app = await anAppServingGoogle();
          await app.signsInOnlyWithSso(GOOGLE);

          const result = await app.disableSso(GOOGLE);

          expect(result).toSuggestExactly(
            `auth-method sso disable --provider google --schema default-human-user --cwd ${app.path} --force`,
          );
        });

        it("disables nothing", async () => {
          const app = await anAppServingGoogle();
          await app.signsInOnlyWithSso(GOOGLE);
          const files = await app.snapshot();

          await app.disableSso(GOOGLE);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("a catalog provider the project does not offer", () => {
        it("succeeds", async () => {
          const app = await aSetUpApp();

          const result = await app.disableSso(GOOGLE);

          expect(result).toSucceed();
        });

        it("changes nothing", async () => {
          const app = await aSetUpApp();
          const files = await app.snapshot();

          await app.disableSso(GOOGLE);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("a provider neither the catalog nor a connection names", () => {
        it("is refused", async () => {
          const app = await anAppServingGoogle();

          const result = await app.disableSso(UNKNOWN_PROVIDER);

          expect(result).toFailWith("E_NOT_FOUND");
        });

        it("changes nothing", async () => {
          const app = await anAppServingGoogle();
          const files = await app.snapshot();

          await app.disableSso(UNKNOWN_PROVIDER);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("a provider already disabled", () => {
        it("succeeds again", async () => {
          const app = await anAppServingGoogle();
          await app.hasDisabledSso(GOOGLE);

          const result = await app.disableSso(GOOGLE);

          expect(result).toSucceed();
        });

        it("changes nothing", async () => {
          const app = await anAppServingGoogle();
          await app.hasDisabledSso(GOOGLE);
          const files = await app.snapshot();

          await app.disableSso(GOOGLE);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("once deployed", () => {
        it("publishes SSO as off", async () => {
          const app = await anAppServingGoogle();

          await app.disableSso(GOOGLE);

          expect(await app.authMethodsOnceDeployed()).toHaveProperty("sso", { enabled: false });
        });

        it("stops offering the provider on any step", async () => {
          const app = await anAppServingGoogle();

          await app.disableSso(GOOGLE);

          expect(await app.stepsOfferingSsoOnceDeployed()).toEqual([]);
        });

        it("keeps the connection, so enabling it again needs no credentials", async () => {
          const app = await anAppServingGoogle();

          await app.disableSso(GOOGLE);

          expect(await app.registeredIdpSlugsOnceDeployed()).toEqual([GOOGLE]);
        });

        it("removes a custom connection named by its slug", async () => {
          const app = await anAppServingAcme();

          await app.disableSso(ACME.slug);

          expect(await app.stepsOfferingSsoOnceDeployed()).toEqual([]);
        });

        it("leaves nothing left to deploy", async () => {
          const app = await anAppServingGoogle();

          await app.disableSso(GOOGLE);

          const [first, again] = await app.releasesOfTwoDeploys();
          expect(again).toBe(first);
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says which provider it removed, and from which schema", async () => {
        const app = await anAppServingGoogle();

        const result = await app.disableSsoRendered(GOOGLE);

        expect(result).toPrint("Removed google from default-human-user");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await anAppServingGoogle();

        const result = await app.disableSsoRendered(GOOGLE);

        expect(result).toPrintNoJson();
      });
    });
  });
});
