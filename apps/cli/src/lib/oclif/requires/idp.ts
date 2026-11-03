import { CUSTOM_PROVIDER, IDP_PROVIDERS, type ProviderSelection } from "@zitadel/config/idp";

import { listedProviders, refuseUneditable } from "../../auth-methods";
import { ZitadelError } from "../../errors";
import {
  checkGivenCustomFlags,
  type CustomFlagValues,
  customExample,
  customFlagValues,
  ENABLE_FLAG_KEYS,
  ENABLE_FLAG_NAMES,
  type FlowFile,
  selectionFromFlags,
  ssoEditRefusal,
} from "../../idp";
import { interpolate } from "../refusal";
import { requirement } from "../requirements";
import type { SchemaTarget } from "./schema";

/**
 * The provider `auth-method sso enable` was asked for. `selection` is
 * undefined for a custom provider whose settings a person will be asked for
 * once everything that can fail has passed; `values` are the settings the
 * flags gave. A person at a terminal is asked for the settings they left out,
 * but later: here the ones they did give are only checked. A script, a dry run
 * or `--non-interactive` is held to the flags and told which are missing.
 */
export type SsoProvider = {
  readonly selection: ProviderSelection | undefined;
  readonly values: CustomFlagValues;
};

function hasAllCustomSettings(values: CustomFlagValues): boolean {
  return (
    values.slug !== undefined && values.displayName !== undefined && values.issuer !== undefined
  );
}

export const ssoProvider = requirement<SsoProvider>({
  resolve: async ({ flags, meta }) => {
    const provider = String(flags[ENABLE_FLAG_KEYS.provider]);
    const values = customFlagValues(
      flags as {
        readonly [K in (typeof ENABLE_FLAG_KEYS)[keyof typeof ENABLE_FLAG_KEYS]]?: string;
      },
      ENABLE_FLAG_KEYS,
    );
    const interactive = !meta.nonInteractive && !meta.dryRun;
    const askLater = provider === CUSTOM_PROVIDER && interactive && !hasAllCustomSettings(values);
    if (askLater) {
      checkGivenCustomFlags(values, ENABLE_FLAG_NAMES);
    }
    return {
      selection: askLater
        ? undefined
        : selectionFromFlags(provider, values, ENABLE_FLAG_NAMES, customExample(ENABLE_FLAG_NAMES)),
      values,
    };
  },
});

const NO_FLOW_HINT =
  "The provider is offered by a flow, and none of the files under .zitadel/flows/ " +
  "names this schema. Check that the flow's user_schema names the schema's objectType.";

/**
 * The flows a provider must be added to. No flow means no button however well
 * everything else went, so a run without one is refused before anything is
 * asked or written, as is a schema or flow with a region the editors cannot
 * recognise and would write over.
 */
export const ssoFlows = requirement<FlowFile[]>({
  resolve: async ({ resolved }) => {
    const { schema, flows } = resolved.target as SchemaTarget;
    if (flows.length === 0) {
      throw new ZitadelError("E_NOT_FOUND", `No login flow runs against ${schema.name}`, {
        hint: NO_FLOW_HINT,
        details: {
          schema: schema.path,
        },
      });
    }
    refuseUneditable(schema.path, ssoEditRefusal(schema.body, "schema"));
    for (const flow of flows) {
      refuseUneditable(flow.path, ssoEditRefusal(flow.body, "flow"));
    }
    return flows;
  },
});

const NAME_PROVIDER_TO_REMOVE = {
  message: "Name the provider to remove",
  hint: "Pass --provider, e.g. --provider {example}. {schema} offers: {offered}.",
} as const;

/**
 * The provider `auth-method sso disable` removes. It is always named, because
 * removing every provider at once would be a different, larger change; the
 * refusal lists the providers the schema offers, well-formed or not.
 */
export const providerToRemove = requirement<string>({
  resolve: async ({ flags, resolved }) => {
    if (typeof flags.provider === "string") {
      return flags.provider;
    }
    const { schema } = resolved.target as SchemaTarget;
    const values = {
      example: IDP_PROVIDERS[0],
      schema: schema.name,
      offered: listedProviders(schema.body).join(", ") || "none",
    };
    throw new ZitadelError("E_VALIDATION", interpolate(NAME_PROVIDER_TO_REMOVE.message, values), {
      hint: interpolate(NAME_PROVIDER_TO_REMOVE.hint, values),
    });
  },
});
