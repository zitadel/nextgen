import type {
  GetVariable200,
  ListDeployments200DeploymentsItem,
} from "@zitadel/api/generated/model";

import type { Answer, ClientStubs } from "@tests/helpers/fake-client";

/**
 * The project every record and service in the tests belongs to.
 */
export const PROJECT_ID = "proj_1";

/**
 * The primary origin that {@link aDeployment} serves from and that the mock
 * project helpers register.
 */
export const PRIMARY_ORIGIN = "https://app.acme.com";

/**
 * The preview pattern the preview fixtures register, which admits
 * {@link PREVIEW_URL}.
 */
export const PREVIEW_PATTERN = "https://*-acme.vercel.app";

/**
 * A preview URL that {@link PREVIEW_PATTERN} admits.
 */
export const PREVIEW_URL = "https://x-acme.vercel.app";

/**
 * A deployment as the API answers one: `dep_1`, serving `rel_1` live on the
 * primary origin {@link PRIMARY_ORIGIN}.
 *
 * @param overrides - Fields to set in place of the defaults.
 * @returns The deployment record.
 */
export function aDeployment(
  overrides: Answer<ListDeployments200DeploymentsItem> = {},
): Answer<ListDeployments200DeploymentsItem> {
  return {
    id: "dep_1",
    project_id: PROJECT_ID,
    release_id: "rel_1",
    kind: "primary",
    status: "live",
    deployed_at: "2026-01-01T00:00:00Z",
    targets: [{ origin: PRIMARY_ORIGIN }],
    metadata: { reason: "deploy" },
    ...overrides,
  };
}

/**
 * A variable's value as the API answers it: a plain value, or `{ secret: true }`.
 */
export type HeldVariable = GetVariable200["primary"];

/**
 * A value the API answers for a secret variable: named, never disclosed.
 */
export const SECRET_VARIABLE: HeldVariable = { secret: true };

/**
 * The project's variables, as `listVariables` answers them.
 *
 * @param held - The values, by variable name.
 * @param kind - The one kind that holds them; left out, every kind does.
 * @returns The client stub that answers them.
 */
export function holdingVariables(
  held: Readonly<Record<string, HeldVariable>>,
  kind?: "primary" | "preview",
): ClientStubs {
  return {
    listVariables: async (params) => {
      const asked = params.kind ?? "primary";
      if (kind !== undefined && asked !== kind) {
        return {};
      }
      return Object.fromEntries(
        Object.entries(held).map(([name, value]) => {
          return [name, { [asked]: value }];
        }),
      );
    },
  };
}
