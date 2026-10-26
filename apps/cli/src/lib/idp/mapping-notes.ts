/**
 * What a person needs to know about the claim mappings a custom connection was
 * written with, in the order they read it: where the mappings are, which side
 * of each line is theirs, what the provider has to do, and what the mapping
 * does not do. Nothing here edits a mapping; the connection file is where that
 * happens.
 *
 * @param options.file - The connection file, as the project shows it.
 * @param options.provider - The name on the sign-in button.
 * @param options.connection - The connection document that was written.
 */
export function mappingNotes(options: {
  file: string;
  provider: string;
  connection: object;
}): string[] {
  const { file, provider, connection } = options;
  const document = connection as {
    claim_mapping?: Readonly<Record<string, string>>;
    verified_claims?: Readonly<Record<string, string | true>>;
  };
  const mappings = Object.entries(document.claim_mapping ?? {});
  if (mappings.length === 0) {
    return [];
  }
  const verified = Object.entries(document.verified_claims ?? {});
  return [
    `Claim mappings in ${file}. Each line is an attribute of your user schema, then the claim ${provider} must return for it:`,
    ...mappings.map(([attribute, claim]) => `  ${attribute} ← ${claim}`),
    ...verified.map(([attribute, how]) =>
      how === true
        ? `${attribute} is treated as verified.`
        : `${attribute} is treated as verified only when ${provider} says so in the ${how} claim.`,
    ),
    "Mapping a value does not by itself mark it verified. Edit the mappings in that file if your provider returns other claims.",
  ];
}
