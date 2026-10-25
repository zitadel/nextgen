import type { SuggestedCommand } from "../suggestion";

/**
 * Builders for the `data` of a command's JSON envelope.
 *
 * Every command emits `data`, and an agent reads all of them, so the shapes
 * must not drift. These builders are the one place each shape is defined; the
 * spec harness (`assertEnvelope`) enforces the same shapes on every `--json`
 * invocation, so a command that hand-builds a divergent shape fails in its own
 * spec. Use the builder rather than an object literal.
 */

/**
 * The canonical list/collection envelope: `{ items, count, next_page_token }`,
 * plus optional `next_commands`. Every command that returns a collection emits
 * this, so `{ items, count, next_page_token }` reads uniformly across all of
 * them. A single-page endpoint passes `nextPageToken: null` (the default); a
 * paginated one passes the server cursor (or `null` once drained).
 */
export function listData<T>(
  items: readonly T[],
  opts: { nextPageToken?: string | null; nextCommands?: readonly SuggestedCommand[] } = {},
): {
  items: readonly T[];
  count: number;
  next_page_token: string | null;
  next_commands?: readonly SuggestedCommand[];
} {
  const base = {
    items,
    count: items.length,
    next_page_token: opts.nextPageToken ?? null,
  };
  return opts.nextCommands && opts.nextCommands.length > 0
    ? { ...base, next_commands: opts.nextCommands }
    : base;
}

/**
 * The canonical delete/remove confirmation: the resource's identifier plus
 * `deleted: true`. The verb is always `deleted` — never `removed` — so an agent
 * reads "did the delete succeed?" the same way for every resource, whether it is
 * addressed by `id` or by a natural key (`url`, `pattern`, `name`). A lifecycle
 * verb (revoke, deactivate) uses {@link mutatedData} instead.
 */
export function deletedData<I extends Record<string, string>>(
  identifier: I,
): I & { deleted: true } {
  return { ...identifier, deleted: true };
}

/**
 * A mutation confirmation whose verb is the lifecycle action, not `deleted`:
 * the identifier plus `<verb>: true` (e.g. `revoked`, `deactivated`). Keeps the
 * `{ identifier, <past-tense>: true }` shape of {@link deletedData} while naming
 * the specific action.
 */
export function mutatedData<I extends Record<string, string>, V extends string>(
  identifier: I,
  verb: V,
): I & Record<V, true> {
  return { ...identifier, [verb]: true } as I & Record<V, true>;
}

/**
 * The `next_commands` a command's `data` carries, spread into the data object:
 * `{ ...result, ...nextCommandsData(commands) }`. It takes `SuggestedCommand`s,
 * which only the `lib/suggestion` builders make, so every entry has had its
 * environment selector decided (#1689). A Biome GritQL rule
 * (`biome-plugins/no-raw-next-commands.grit`) rejects a hand-written
 * `next_commands:` key anywhere else.
 */
export function nextCommandsData(commands: readonly SuggestedCommand[]): {
  next_commands: readonly SuggestedCommand[];
} {
  return { next_commands: commands };
}
