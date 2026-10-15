import { ZitadelError } from "../errors";
import type { SuggestedCommand } from "../suggestion";

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

/**
 * Refuse an `--origin` that is not one of the project's primary origins, before
 * anything is written. A primary pattern is an exact URL, so a literal match is
 * a primary target — and a literal beats a wildcard. A preview pattern may be a
 * wildcard, so it is matched by glob: a concrete URL a preview wildcard covers
 * is still a preview, served by pull-request builds, and must not slip through
 * as a primary target. `unknown` is what to suggest for an origin the project
 * does not hold at all.
 */
export function assertPrimaryOrigin(
  origins: readonly ProjectOriginEntry[],
  origin: string,
  unknown: { hint: string; nextCommands: SuggestedCommand[] },
): void {
  if (origins.some((entry) => entry.kind === "primary" && entry.pattern === origin)) {
    return;
  }
  if (
    origins.some((entry) => entry.kind === "preview" && originMatchesPattern(entry.pattern, origin))
  ) {
    throw new ZitadelError("E_VALIDATION", `${origin} is a preview origin`, {
      hint: "Pass a primary origin; preview origins are served by pull-request builds.",
    });
  }
  throw new ZitadelError("E_VALIDATION", `${origin} is not an origin of the project`, unknown);
}
