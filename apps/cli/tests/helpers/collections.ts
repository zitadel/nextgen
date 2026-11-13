import { operations } from "@zitadel/api/generated/operations";

/**
 * Each command that lists a collection, with the name the API gives that
 * collection: the field its page holds the items under (`policies` for
 * `policy list`). That name is the plural someone who knows the API, or the
 * CLI from before its nouns were singular, types for the command's noun, and
 * it comes from the spec, not from the rule the CLI forms a plural by.
 */
export const LISTED_COLLECTIONS = operations.flatMap((operation) => {
  const [noun, verb] = operation.cli?.split(" ") ?? [];
  return noun !== undefined && verb === "list" && operation.paging !== null
    ? [{ noun, collection: operation.paging.items.replaceAll("_", "-") }]
    : [];
});

/**
 * The collections whose name is not their command's own (`branding` is both),
 * each with its command's noun: `["policies", "policy"]`.
 */
export const COLLECTION_PLURALS = LISTED_COLLECTIONS.filter(({ noun, collection }) => {
  return collection !== noun;
}).map(({ noun, collection }) => {
  return [collection, noun] as const;
});
