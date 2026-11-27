import type { ClientBuilder, GeneratorClients, GetterProp, OutputClientFunc } from "orval";

/**
 * The one text substitution a generated operation needs, and the text it must
 * replace. orval writes the mutator call and the `options` type as fixed text,
 * so each is replaced as text; a pattern that does not occur exactly once
 * means orval changed what it writes, and generation fails rather than write
 * an operation that ignores its client.
 */
type Substitution = Readonly<{ find: string; replace: string }>;

/**
 * Replaces each substitution's text in one operation's source.
 *
 * @param operation - The generated function's name, for the error.
 * @param source - The operation's generated source.
 * @param substitutions - What to replace, each found exactly once.
 * @returns The source with every substitution applied.
 * @throws Error when a pattern occurs other than exactly once.
 */
export function substituteOnce(
  operation: string,
  source: string,
  substitutions: readonly Substitution[],
): string {
  let result = source;
  for (const { find, replace } of substitutions) {
    const count = result.split(find).length - 1;
    if (count !== 1) {
      throw new Error(
        `${operation}: expected \`${find}\` once in the generated operation, found it ${count} times; orval changed what it writes, so update scripts/client-builder.ts`,
      );
    }
    result = result.replace(find, replace);
  }
  return result;
}

/**
 * The `client` parameter every operation takes first. orval places a header
 * prop where it is listed and renders it as written, so it leads the
 * parameter list and no other argument can be mistaken for it.
 */
const CLIENT_PROP: GetterProp = {
  name: "client",
  definition: "client: ZitadelClient",
  implementation: "client: ZitadelClient",
  default: undefined,
  required: true,
  type: "header",
};

/**
 * orval's fetch client, with every operation taking the {@link ZitadelClient}
 * it runs against as a required first argument and handing it, and its own
 * name, to the transport: `getProject(client, projectId, options?)` calls
 * `customFetch(client, "getProject")`. Forgetting the client is a compile
 * error, and nothing about a request is read from anywhere but that client.
 *
 * `options` stays plain `RequestInit` for the per-call extras (headers,
 * `credentials`, a signal). The URL builder orval writes beside each operation
 * (`getProject` → `getGetProjectUrl`) stays in the file for the operation to
 * call, but is not exported, so the module exports only operations.
 *
 * @param clients - orval's built-in clients.
 * @returns The fetch client's builders, with its operation builder wrapped.
 */
export const zitadelClient: OutputClientFunc = (clients: GeneratorClients) => {
  const fetch = clients.fetch;
  const client: ClientBuilder = async (verbOptions, options, outputClient, output) => {
    const generated = await fetch.client(
      { ...verbOptions, props: [CLIENT_PROP, ...verbOptions.props] },
      options,
      outputClient,
      output,
    );
    const mutator = verbOptions.mutator?.name;
    if (mutator === undefined) {
      throw new Error(`${verbOptions.operationName}: the client needs orval's mutator to be set`);
    }
    const name = verbOptions.operationName;
    const urlBuilder = `get${name.charAt(0).toUpperCase()}${name.slice(1)}Url`;
    return {
      ...generated,
      imports: [
        ...generated.imports,
        { name: "ZitadelClient", importPath: "../../runtime/client", isConstant: false },
      ],
      implementation: substituteOnce(name, generated.implementation, [
        { find: `${mutator}<`, replace: `${mutator}(client, ${JSON.stringify(name)})<` },
        { find: `Parameters<typeof ${mutator}>[1]`, replace: "RequestInit" },
        { find: `export const ${urlBuilder} = `, replace: `const ${urlBuilder} = ` },
      ]),
    };
  };
  return { ...fetch, client };
};
