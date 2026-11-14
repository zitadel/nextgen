import { describe, expect, it } from "vitest";

import type { SetupAnswers, SsoDraft } from "@/cli/commands/setup/shared";
import { MapClaims } from "@/cli/commands/setup/steps/map-claims";
import { asTerminal } from "@tests/helpers/terminal";
import { acmeSelection, clientId, clientSecret, googleSelection } from "@tests/helpers/idp-values";
import { answering } from "@tests/helpers/keyboard";
import { aPromptDeps } from "@tests/helpers/setup";

/**
 * What a person picks to keep the claims the connection maps by default.
 */
const KEEP_CLAIMS = "No, keep these";

/**
 * A provider with its credentials, and nothing yet said about its claims.
 *
 * @param selection - The provider.
 * @param claimRequest - What the flags asked for, if anything.
 * @returns The draft.
 */
function aDraft(
  selection: SsoDraft["selection"],
  claimRequest?: SsoDraft["claimRequest"],
): SsoDraft {
  return {
    selection,
    credentials: { clientId: clientId("an-id"), secret: clientSecret("a-secret") },
    claimRequest,
  };
}

/**
 * The answers setup has gathered for a business app with the given providers.
 *
 * @param sso - The providers.
 * @returns The answers.
 */
function answersWith(...sso: readonly SsoDraft[]): SetupAnswers {
  return {
    server: "https://preview.zitadel.com",
    devPort: 3000,
    preset: "password-first",
    useCase: "business",
    sso,
  };
}

/**
 * Runs the step with a person at the keyboard.
 *
 * @param answers - What the setup has gathered.
 * @param typed - What the person answers, in the order asked.
 * @param deps - What differs from an interactive run.
 * @returns The answers the step leaves, and what the person was asked and shown.
 */
async function mapWith(
  answers: SetupAnswers,
  typed: readonly string[],
  deps: Partial<ReturnType<typeof aPromptDeps>> = {},
) {
  const talk = answering(...typed);
  const result = await asTerminal(() => {
    return new MapClaims({ ...aPromptDeps(), ...deps }).run({ answers });
  });
  return { answers: result.answers, asked: talk.asked(), shown: talk.plain() };
}

describe("MapClaims", () => {
  it("asks whether other claims should be mapped from each provider the flags left out", async () => {
    const { asked } = await mapWith(answersWith(aDraft(googleSelection), aDraft(acmeSelection)), [
      KEEP_CLAIMS,
      KEEP_CLAIMS,
    ]);

    expect(asked).toEqual([
      'Should any other claims be mapped from "Google"?',
      'Should any other claims be mapped from "Acme SSO"?',
    ]);
  });

  it("shows what the provider maps by default first", async () => {
    const { shown } = await mapWith(answersWith(aDraft(googleSelection)), [KEEP_CLAIMS]);

    expect(shown).toMatch(/email\s+email\s+yes, by email_verified/);
  });

  it("keeps the defaults for a person who has nothing to add", async () => {
    const { answers } = await mapWith(answersWith(aDraft(googleSelection)), [KEEP_CLAIMS]);

    expect(answers.sso[0]?.claimRequest).toEqual({ entries: [], verified: [], scopes: [] });
  });

  it("hands back the claim a person mapped, as the flags would have carried it", async () => {
    const { answers } = await mapWith(answersWith(aDraft(googleSelection)), [
      "Yes, map another claim",
      "organization",
      "Text",
      "companyName",
      "",
      KEEP_CLAIMS,
    ]);

    expect(answers.sso[0]?.claimRequest).toEqual({
      entries: [{ attribute: "companyName", claim: "organization" }],
      verified: [],
      scopes: [],
    });
  });

  it("leaves a provider the flags gave claims for as it is", async () => {
    const asked = {
      entries: [{ attribute: "companyName", claim: "organization" }],
      verified: [],
      scopes: [],
    };
    const draft = aDraft(googleSelection, asked);

    const { answers, asked: questions } = await mapWith(answersWith(draft), []);

    expect([answers.sso, questions]).toEqual([[draft], []]);
  });

  it.each([
    ["nobody can be asked", { nonInteractive: true }],
    ["the run only previews", { dryRun: true }],
  ])("asks nothing when %s", async (_why, deps) => {
    const draft = aDraft(googleSelection);

    const { answers, asked } = await mapWith(answersWith(draft), [], deps);

    expect([answers.sso, asked]).toEqual([[draft], []]);
  });
});
