/**
 * A stored flow as the Go server answers with it: an action's `primary: false`
 * (a default), an empty `fields` list, and an empty `gates` map or
 * `sso_providers` list are left out (`internal/api/flow_definition.go`:
 * `nilIfEmpty`, `mapGatesToAPI`). Echoing them back would let a client pass
 * against a server it never meets, because a file written back from the real
 * server does not carry them.
 */
export function serverCanonicalFlow(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.steps)) {
    return body;
  }
  return {
    ...body,
    steps: body.steps.map((step: unknown) => {
      if (typeof step !== "object" || step === null) {
        return step;
      }
      const copy: Record<string, unknown> = { ...(step as Record<string, unknown>) };
      for (const key of ["fields", "gates", "sso_providers"]) {
        const value = copy[key];
        const empty = Array.isArray(value)
          ? value.length === 0
          : typeof value === "object" && value !== null && Object.keys(value).length === 0;
        if (empty) {
          delete copy[key];
        }
      }
      if (Array.isArray(copy.actions)) {
        copy.actions = copy.actions.map((action: unknown) => {
          if (typeof action !== "object" || action === null) {
            return action;
          }
          const { primary, ...rest } = action as Record<string, unknown>;
          return primary === false ? rest : action;
        });
      }
      return copy;
    }),
  };
}
