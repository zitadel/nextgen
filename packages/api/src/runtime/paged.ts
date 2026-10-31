/**
 * The client's own use of the cursor walk: `pages`, `items` and `all` on one
 * generated function. Internal to the package; `./paging` is what it exports.
 */
import { pages } from "./paging";

/** How a generated function pages: the field holding its items, and the argument carrying `page_token`. */
type PagingShape = Readonly<{ items: string; arg: number }>;

/** What the client does to every response and every failure. */
type Hooks = Readonly<{
  respond: (body: unknown) => unknown;
  fail: (error: unknown) => never;
}>;

/**
 * `pages`, `items` and `all` for one generated function. Each takes the
 * function's own arguments; the first page is fetched with them as given, so a
 * `page_token` among them is where it starts. `send` fetches a page as the
 * server answers it, so the cursor is read before `hooks.respond` sees the
 * page, and every failure of the walk reaches `hooks.fail` once.
 */
export function paged(send: (...args: unknown[]) => unknown, shape: PagingShape, hooks: Hooks) {
  async function* walk<T>(args: unknown[], take: (page: unknown) => readonly T[]) {
    const raw = pages(async (token) => {
      if (token === undefined) {
        return send(...args);
      }
      // Built fresh rather than with `Array.prototype.with`, which throws when
      // the caller left an optional argument at `shape.arg` off.
      const pageArgs = Array.from({ length: Math.max(args.length, shape.arg + 1) }, (_, i) =>
        i === shape.arg ? { ...(args[i] as object | undefined), page_token: token } : args[i],
      );
      return send(...pageArgs);
    });
    try {
      for await (const page of raw) {
        for (const value of take(await hooks.respond(page))) {
          yield value;
        }
      }
    } catch (error) {
      hooks.fail(error);
    }
  }

  // The generated types promise each page holds its list under `shape.items`.
  const listOf = (page: unknown) =>
    (page as Record<string, unknown>)[shape.items] as readonly unknown[];

  return {
    pages: (...args: unknown[]) => walk(args, (page) => [page]),
    items: (...args: unknown[]) => walk(args, listOf),
    all: async (...args: unknown[]) => {
      const collected: unknown[] = [];
      for await (const list of walk(args, (page) => [listOf(page)])) {
        collected.push(...list);
      }
      return collected;
    },
  };
}
