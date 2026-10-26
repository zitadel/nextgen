/** One of a project's origin patterns, as `GET /projects/{id}` returns it. */
export type ProjectOriginEntry = Readonly<{ pattern: string; kind: string }>;

/**
 * Whether an origin pattern covers a concrete origin URL, matching the server's
 * glob rule: a `*` stands for one or more characters, none of them a dot, so
 * `https://*.preview.acme.com` covers `https://pr-7.preview.acme.com` but not a
 * deeper label. A pattern with no `*` matches only its exact self.
 */
export function originMatchesPattern(pattern: string, origin: string): boolean {
  // Every literal part is escaped whole, so only the `*` between them is a
  // wildcard in the expression.
  const literal = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = pattern.split("*").map(literal).join("[^.]+");
  return new RegExp(`^${expression}$`).test(origin);
}
