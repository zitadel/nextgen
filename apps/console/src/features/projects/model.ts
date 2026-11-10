/** Projects as the chrome names and orders them. Pure: no requests, no React. */

/** A project as the chrome names it. */
export interface ProjectRef {
  id: string;
  name: string;
  /**
   * The host of the project's first primary origin off the local machine,
   * when it has one: what tells two projects of one name apart, as a site's
   * domain does.
   */
  host?: string;
}

/** What a project read carries that the chrome uses. */
interface ProjectRead {
  id: string;
  name: string;
  origins?: ReadonlyArray<{ pattern: string; kind: string }>;
}

export function toProjectRef({ id, name, origins }: ProjectRead): ProjectRef {
  const host = primaryHost(origins);
  return host ? { id, name, host } : { id, name };
}

/**
 * The host of the first primary origin that parses and is not loopback
 * (`shop.example.com`). Preview patterns are left out: one may hold a `*`,
 * which names no host. So is the local machine, which many projects list for
 * development and so tells none of them apart.
 */
export function primaryHost(origins: ProjectRead["origins"]): string | undefined {
  for (const origin of origins ?? []) {
    if (origin.kind !== "primary") continue;
    try {
      const { host, hostname } = new URL(origin.pattern);
      if (host && !isLoopback(hostname)) return host;
    } catch {
      // The server keeps an unknown host as written; one that does not parse
      // names nothing to show.
    }
  }
  return undefined;
}

/**
 * Whether a hostname is the local machine, as the server reads an origin
 * (`domain.IsLoopbackOrigin`): localhost, a `*.localhost` name, or a loopback
 * address.
 */
function isLoopback(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(name)
  );
}

/** Names as a reader orders them: any case, and `app-2` before `app-10`. */
const NAME_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** By name, then by id, so two projects of one name keep their places. */
export function byName<T extends { id: string; name: string }>(projects: readonly T[]): T[] {
  return [...projects].sort(
    (a, b) => NAME_ORDER.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
