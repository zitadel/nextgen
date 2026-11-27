import type {
  ItemOf,
  OperationName,
  PageOf,
  PagedOperation,
  ZitadelApi as ZitadelClient,
} from "@zitadel/api/client";

/**
 * A value a stub answers with: the shape the generated client declares, with
 * only the fields the test cares about.
 *
 * Field names and their types stay checked, so a stub that answers a field the
 * contract does not have fails to compile; completeness does not, because a
 * double that had to spell out every field of a generated response would bury
 * the one value under test. This is the single place a double meets the
 * generated types, so no test needs a cast of its own.
 */
export type Answer<T> = T extends readonly (infer E)[]
  ? readonly Answer<E>[]
  : T extends object
    ? { [K in keyof T]?: Answer<T[K]> }
    : T;

/** The arguments the client's own function takes. */
type Args<K extends OperationName> = ZitadelClient[K] extends (...args: infer A) => unknown
  ? A
  : never;

/** What the client's own function resolves with. */
type Resolves<K extends OperationName> = ZitadelClient[K] extends (
  ...args: never[]
) => Promise<infer R>
  ? R
  : never;

/** One operation stubbed as the call it is: the real arguments, a loose answer. */
type CallStub<K extends OperationName> = (...args: Args<K>) => Promise<Answer<Resolves<K>>>;

/**
 * A paged operation stubbed by the walk the code under test uses: `all` for
 * every item, `pages` for the pages themselves, `items` for one item at a
 * time. Only the walk a test exercises has to be given.
 */
type PagedStub<K extends PagedOperation> = {
  all?: (...args: Args<K>) => Promise<readonly Answer<ItemOf<K>>[]>;
  pages?: (...args: Args<K>) => AsyncIterable<Answer<PageOf<K>>>;
  items?: (...args: Args<K>) => AsyncIterable<Answer<ItemOf<K>>>;
};

/** The operations a test stubs. Anything left out fails the call that reaches it. */
export type ClientStubs = {
  [K in OperationName]?: K extends PagedOperation ? CallStub<K> | PagedStub<K> : CallStub<K>;
};

/**
 * The operation a test did not stub, which fails when something calls it.
 *
 * Its own properties answer the same way, so a paged operation reached as
 * `listDeployments.all(…)` names the operation too rather than failing as a
 * missing property.
 */
function unstubbed(operation: string): () => never {
  const refuse = (): never => {
    throw new Error(
      `The fake client has no ${operation}: stub it in fakeClient({ ... }) to answer this call.`,
    );
  };
  return new Proxy(refuse, {
    get(target, property) {
      if (property === "then") {
        return undefined;
      }
      return property in target ? Reflect.get(target, property) : refuse;
    },
  });
}

/**
 * A {@link ZitadelClient} that answers only what a test stubbed.
 *
 * Reaching an operation the test left out gives back a function that fails
 * when it is called, naming the operation, so a service that grew a call shows
 * up as that call rather than as `undefined is not a function`.
 *
 * Every read is answered by the stubs; the proxy has the client's type, and
 * nothing behind it.
 *
 * @param stubs - The operations this test answers, by their client name.
 * @returns The client, for a service's constructor.
 */
export function fakeClient(stubs: ClientStubs): ZitadelClient {
  const answers: ReadonlyMap<string, unknown> = new Map(Object.entries(stubs));
  // A plain object as the target: the real client is frozen, and a proxy may
  // not answer a frozen property with anything but its own value.
  return new Proxy({} as ZitadelClient, {
    get(_target, property) {
      if (typeof property !== "string") {
        return undefined;
      }
      const stub = answers.get(property);
      if (stub === undefined) {
        return unstubbed(property);
      }
      if (typeof stub === "function") {
        return stub;
      }
      return Object.assign(unstubbed(`${property} as a single page`), stub);
    },
  });
}

/**
 * The pages of a paged operation, for a `pages` stub.
 *
 * @param pages - The pages to yield, in the order the server would answer them.
 * @returns The walk the client's own `pages` would return.
 */
export async function* pagesOf<T>(...pages: readonly T[]): AsyncGenerator<T> {
  for (const page of pages) {
    yield page;
  }
}
