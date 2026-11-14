import {
  claimRequestFromFlags,
  customExample,
  customFlagValues,
  loopbackIssuerWarning,
  selectionFromFlags,
  SETUP_FLAG_KEYS,
  SETUP_FLAG_NAMES,
} from "@/lib/idp";
import type { Fact, SetupServices, SsoDraft } from "@/cli/commands/setup/shared";
import { askCustomSettings, ssoClaimFlags } from "@/cli/commands/setup/shared";
import { type ClientId, CUSTOM_PROVIDER, parseClientSecret, providerOf } from "@zitadel/config/idp";
import { andTheRest, pipedFrom, type Suggest } from "@/lib/suggestion";
import type { Questions } from "@/lib/ui";
import { reportWarning } from "@/lib/warnings";

import { WizardStep } from "@/lib/wizard";

/**
 * The client id a suggested `setup` leaves for the reader to fill in. It is no
 * client id a provider issued, but a `FillIn` (`src/lib/suggestion`), which a
 * suggestion takes for any flag's value.
 */
const ID_TO_FILL_IN = "<id>";

/** What a command line describing a custom connection looks like, for an error to show. */
const SSO_CUSTOM_EXAMPLE = customExample(SETUP_FLAG_NAMES);

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "ask" | "dryRun" | "nonInteractive" | "suggest">;

/**
 * Reads the provider the command line asked for.
 *
 * @remarks
 * Resolved before anything is detected, created or written: an inconsistent set
 * of `--sso` flags is a mistake in the command line, and reporting it after a
 * project has been created would leave the developer to clean up. It cannot ask
 * a `confirm`, so setup's `--force`, which permits overwriting files, never
 * answers one of its questions.
 */
export class ReadSsoFlags extends WizardStep<"ssoFlags", Fact<"ssoFromCommandLine">, Needs> {
  readonly key = "ssoFlags";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Read the `--sso` flags.
   *
   * @param needs - The flags.
   * @param this.deps - What the command provides.
   * @returns The provider, when one was asked for.
   */
  async run(needs: Needs): Promise<Fact<"ssoFromCommandLine">> {
    return {
      ssoFromCommandLine: await ssoFromFlags(
        needs.flags,
        this.deps.nonInteractive,
        this.deps.dryRun,
        this.deps.ask,
        this.deps.suggest,
      ),
    };
  }
}

/**
 * The provider a scripted run asked for, or `undefined` when it asked for
 * none — in which case the wizard's question decides.
 *
 * The client id is required alongside the provider rather than prompted for:
 * a run that named a provider on the command line is scripted, and stopping
 * to ask would hang it.
 *
 * The secret is never a flag, following `variable set`: it cannot reach
 * shell history, a process listing or a CI log. Only a scripted run reads it
 * from stdin — an interactive one is asked, and consuming stdin there would
 * leave the wizard's own prompts reading a stream already at EOF. A terminal
 * on stdin means nothing was piped, and reading it would block forever, so
 * that case is treated as "not supplied".
 *
 * @remarks
 * Described before the credentials are asked for, and before a Project is created: a name or issuer
 * the server would refuse is a mistake in the command line. An interactive run asks for the custom
 * settings it was not given, the way it asks for a client id: `--sso` skips the question it answers
 * and no other.
 *
 * The wizard asks for the secret, the way it asks for a client id that `--sso-client-id` did not
 * answer. A preview publishes nothing and materialises nothing, so demanding a real credential to
 * see what setup would do is a toll for no reason -- and `auth-method sso enable --dry-run` returns
 * before asking for one at all.
 *
 * Required, not optional: scaffolding the connection without it writes a sign-in button that fails
 * at the provider with `invalid_client`, long after setup reports success. It is never a flag —
 * that would put it in shell history, a process listing and CI logs.
 *
 * The secret's retry is a concrete rerun for an agent, never carrying the value: the secret is
 * piped from the caller's own environment.
 *
 * @param flags - The `--sso` flags.
 * @param nonInteractive - Whether nothing can be asked.
 * @param dryRun - Whether the run only previews.
 * @param ask - How questions are asked.
 * @param suggest - Renders the suggested rerun.
 * @returns The provider and the credentials collected so far, or `undefined` when none was asked for.
 */
export async function ssoFromFlags(
  flags: {
    sso?: string;
    ssoClientId?: ClientId;
    ssoSlug?: string;
    ssoDisplayName?: string;
    ssoIssuer?: string;
    ssoScopes?: string;
    ssoClaim?: readonly string[];
    ssoVerifiedClaim?: readonly string[];
    ssoClaimScope?: string;
  },
  nonInteractive: boolean,
  dryRun: boolean,
  ask: Questions,
  suggest: Suggest,
): Promise<SsoDraft | undefined> {
  const customValues = customFlagValues(flags, SETUP_FLAG_KEYS);
  if (flags.sso === undefined) {
    return undefined;
  }
  const claimRequest = claimRequestFromFlags({
    claim: flags.ssoClaim,
    scope: flags.ssoClaimScope,
    verified: flags.ssoVerifiedClaim,
  });
  const selection = selectionFromFlags(
    flags.sso,
    flags.sso === CUSTOM_PROVIDER && !nonInteractive
      ? await askCustomSettings(customValues, ask)
      : customValues,
    SETUP_FLAG_NAMES,
    SSO_CUSTOM_EXAMPLE,
  );
  const loopback = loopbackIssuerWarning(selection);
  if (loopback !== undefined) {
    reportWarning(loopback);
  }
  if (flags.ssoClientId === undefined) {
    return {
      selection,
      credentials: {},
      claimRequest,
    };
  }
  if (!nonInteractive || dryRun) {
    return {
      selection,
      credentials: { clientId: flags.ssoClientId },
      claimRequest,
    };
  }
  return {
    selection,
    claimRequest,
    credentials: {
      clientId: flags.ssoClientId,
      secret: await ask.secret({
        name: "client secret",
        message: `What is the client secret of your ${providerOf(selection).displayName} OAuth app?`,
        parse: parseClientSecret,
        stdin: true,
        retry: pipedFrom(
          "CLIENT_SECRET",
          andTheRest(
            suggest({
              id: "setup",
              flags: {
                sso: flags.sso,
                ssoClientId: ID_TO_FILL_IN,
                ...ssoClaimFlags(claimRequest),
              },
            }),
          ),
        ),
      }),
    },
  };
}
