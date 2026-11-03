import type { Target } from "../../../lib/api/operations";
import { type ApiRequest, buildRequest, readInput } from "../../../lib/api/request";
import { requirement } from "../../../lib/oclif/requirements";
import type { Chosen } from "./operation";
import type { ProjectSecret } from "./secret";

/** The request the fields and the body make, before its path parameters are filled in. */
export type Payload = Readonly<{
  request: ApiRequest | undefined;
}>;

/**
 * `--field` and `--input` laid over the operation's schema, each typed by it.
 * It refuses a field the operation does not take, a value of the wrong type, a
 * body on an operation that takes none, and `--input -` with nothing piped in.
 */
export async function requestOf(
  target: Target,
  flags: Readonly<Record<string, unknown>>,
  projectId: string | undefined,
): Promise<ApiRequest> {
  return buildRequest({
    target,
    fields: (flags.field as readonly string[] | undefined) ?? [],
    input: await readInput(flags.input as string | undefined),
    projectId,
  });
}

export const apiPayload = requirement<Payload>({
  resolve: async ({ flags, resolved }) => {
    const { target } = resolved.operation as Chosen;
    const { secret } = resolved.secret as ProjectSecret;
    return {
      request:
        target === undefined ? undefined : await requestOf(target, flags, secret?.project_id),
    };
  },
});
