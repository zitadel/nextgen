import type { ConnectionSummary, UnmappedProperty } from "@/lib/zitadel";

/**
 * Where a connection stands, so "saved", "applied" and "tested" are not
 * confused. `present` is a connection file that was already there: whether it
 * reached the server is not known here.
 */
export type ConnectionState = "saved" | "applied" | "present";

/**
 * One thing left to do, and the commands that do it, if any.
 */
export type Step = {
  /**
   * What to do, as a sentence.
   */
  readonly text: string;

  /**
   * The commands that do it, each run as written.
   */
  readonly commands?: readonly string[];
};

/**
 * What {@link stillToConfigure} needs to know about the connection.
 */
export type StillToConfigure = {
  /**
   * Where the connection stands.
   */
  readonly state: ConnectionState;

  /**
   * The connection's file.
   */
  readonly file: string;

  /**
   * The provider's display name.
   */
  readonly provider: string;

  /**
   * Whether a deploy is still needed. Defaults to a connection only saved.
   */
  readonly deploy?: boolean;

  /**
   * The commands that deploy, shown under that step when they can be run as
   * written.
   */
  readonly deployCommands?: readonly string[];

  /**
   * The commands that publish credentials which did not reach the project.
   */
  readonly republish?: readonly string[];
};

/**
 * A list as an English phrase: "a", "a and b", "a, b and c".
 *
 * @param items - The items.
 * @returns The phrase.
 */
function sentenceList(items: readonly string[]): string {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What makes a mapped property trusted, as the end of its sentence.
 *
 * @param how - The claim that verifies it, `true` when it is always trusted,
 *   or nothing when nothing verifies it.
 * @returns The clause, or nothing.
 */
function trustedBy(how: string | boolean | undefined): string {
  if (how === undefined || how === false) {
    return "";
  }
  if (how === true) {
    return ", and is always trusted";
  }
  return `, verified when ${how} is true`;
}

/**
 * The mapping as sentences for a person.
 *
 * @remarks
 * One line per property, saying which claim fills it and, in the same
 * sentence, what makes it trusted: to a reader that is one fact about the
 * property, not two tables to cross-reference. A verification of a property
 * no claim fills has nothing to fold into and is left out; `deploy` judges
 * such a mismatch.
 *
 * @param summary - The connection's summary.
 * @param file - The connection's file, named so the person knows where to edit.
 * @returns The lines.
 */
export function mappingLines(summary: ConnectionSummary, file: string): readonly string[] {
  const verifiedBy = new Map(
    summary.verifications.map((row) => {
      return [String(row.property), row.claim];
    }),
  );
  const mapping =
    summary.mappings.length === 0
      ? [
          `No attribute is filled from a claim yet. Add attribute: claim pairs to claim_mapping in ${file}.`,
        ]
      : [
          "Each user attribute is filled from a claim your provider returns:",
          ...summary.mappings.map((row) => {
            const trusted = trustedBy(verifiedBy.get(String(row.property)));
            return `- ${row.property} comes from the ${row.claim} claim${trusted}.`;
          }),
        ];
  if (summary.scopes.length === 0) {
    return mapping;
  }
  const plural = summary.scopes.length > 1 ? "s" : "";
  return [
    ...mapping,
    "",
    `It asks your provider for the ${sentenceList(summary.scopes)} scope${plural}.`,
  ];
}

/**
 * The block naming the properties still without a claim.
 *
 * @remarks
 * Told as information, not an instruction: an unmapped property is only a
 * problem when a sign-in needs it. A required one has to be collected by a
 * sign-up step, since this connection does not fill it; an optional one is
 * fine to leave.
 *
 * @param unmapped - The properties no claim fills.
 * @returns The lines; none when every property is mapped.
 */
export function unmappedLines(unmapped: readonly UnmappedProperty[]): readonly string[] {
  if (unmapped.length === 0) {
    return [];
  }
  return [
    "",
    "Some attributes have no claim yet:",
    ...unmapped.map((entry) => {
      if (entry.required) {
        return `- ${entry.property} (required) - not filled by this connection, so sign-up has to collect it.`;
      }
      return `- ${entry.property} (optional) - fine to leave empty.`;
    }),
  ];
}

/**
 * The block naming the schemas that sign in through the connection, so a
 * change to its mapping shows who it affects.
 *
 * @param schemas - The schemas' names.
 * @returns The lines.
 */
export function usedByLines(schemas: readonly string[]): readonly string[] {
  if (schemas.length === 0) {
    return [
      "",
      "No user schema signs in through this connection yet, so changing it affects nothing today.",
    ];
  }
  const verb = schemas.length > 1 ? "sign" : "signs";
  const them = schemas.length > 1 ? "them" : "it";
  return [
    "",
    `${sentenceList(schemas)} ${verb} in through this connection, so changes here affect ${them}.`,
  ];
}

/**
 * The body a connection is summarised by, the same in every command that
 * shows one: what it maps, what makes it verified, the scopes it asks for,
 * the properties no claim fills, and which schemas sign in through it.
 *
 * @param summary - The connection's summary.
 * @param file - The connection's file.
 * @returns The lines.
 */
export function summaryLines(summary: ConnectionSummary, file: string): readonly string[] {
  return [
    ...mappingLines(summary, file),
    ...unmappedLines(summary.unmapped),
    ...usedByLines(summary.usedBy),
  ];
}

/**
 * The state line: where the connection exists, and that no sign-in has
 * tested it.
 *
 * @param state - Where the connection stands.
 * @returns The line.
 */
export function stateLine(state: ConnectionState): string {
  switch (state) {
    case "saved":
      return "Saved in your project. Not applied, not tested.";
    case "applied":
      return "Saved and applied. Not tested with a sign-in.";
    case "present":
      return "In your project. `zitadel deploy --dry-run` shows whether it is deployed. Not tested.";
  }
}

/**
 * What is still to do for a connection, in the order it is done.
 *
 * @remarks
 * A deploy is among them when a file changed that has not reached the server.
 * The last step is always there: a sign-in is the only proof that the claims
 * a provider returns are the ones the mapping names.
 *
 * @param input - The connection and the commands that finish it.
 * @returns The steps.
 */
export function stillToConfigure(input: StillToConfigure): readonly Step[] {
  const deployCommands = input.deployCommands ?? [];
  const republish = input.republish ?? [];
  const deploy = input.deploy ?? input.state === "saved";
  const publishStep: readonly Step[] =
    republish.length > 0
      ? [{ text: "Publish the credentials that did not reach your Project:", commands: republish }]
      : [];
  const deployStep: readonly Step[] = !deploy
    ? []
    : deployCommands.length > 0
      ? [
          {
            text: `Deploy, so ${input.provider} sign-in reaches your app:`,
            commands: deployCommands,
          },
        ]
      : [{ text: `Run \`zitadel deploy\`, so ${input.provider} sign-in reaches your app.` }];
  return [
    { text: `Register the redirect URI at ${input.provider}.` },
    { text: `Check the claim names in ${input.file}.` },
    ...publishStep,
    ...deployStep,
    { text: `Sign in once with ${input.provider}: until then the mapping is untested.` },
  ];
}

/**
 * Steps as numbered lines, each command on a line of its own under its step
 * so it can be copied without the sentence around it.
 *
 * @param steps - The steps.
 * @returns The lines.
 */
export function stepLines(steps: readonly Step[]): readonly string[] {
  return steps.flatMap((step, at) => {
    const marker = `${at + 1}. `;
    const pad = " ".repeat(marker.length);
    return [
      `${marker}${step.text}`,
      ...(step.commands ?? []).map((command) => {
        return `${pad}\`${command}\``;
      }),
    ];
  });
}

/**
 * What a connection's `--json` result says it maps.
 *
 * @param summary - The connection's summary.
 * @returns `claim_mapping`, `verified_claims` and `scopes`, as the file holds them.
 */
export function mappingData(summary: ConnectionSummary): {
  readonly claim_mapping: Readonly<Record<string, string>>;
  readonly verified_claims: Readonly<Record<string, string | boolean>>;
  readonly scopes: readonly string[];
} {
  return {
    claim_mapping: Object.fromEntries(
      summary.mappings.map((row) => {
        return [String(row.property), row.claim];
      }),
    ),
    verified_claims: Object.fromEntries(
      summary.verifications.map((row) => {
        return [String(row.property), row.claim];
      }),
    ),
    scopes: summary.scopes,
  };
}
