import { distance } from "fastest-levenshtein";

/**
 * The one name a mistyped name most likely meant.
 *
 * A different case, or a name one or two edits away, counts; a name of four
 * characters or fewer tolerates one. A name of one or two characters is as
 * close to a dozen others as to the one meant, so it names nothing, and so does
 * a tie, because guessing between two is no help.
 *
 * @param name - The name as written.
 * @param candidates - The names it could have meant.
 * @returns The name it most likely meant, or `undefined`.
 */
export function closest(name: string, candidates: Iterable<string>): string | undefined {
  if (name.length < 3) {
    return undefined;
  }
  const allowed = name.length <= 4 ? 1 : 2;
  const scored = [...new Set(candidates)]
    .filter((candidate) => {
      return candidate !== name;
    })
    .map((candidate) => {
      if (candidate.toLowerCase() === name.toLowerCase()) {
        return { candidate, cost: 0 };
      }
      return { candidate, cost: distance(name, candidate) };
    })
    .filter((entry) => {
      return entry.cost <= allowed;
    });
  const best = Math.min(
    ...scored.map((entry) => {
      return entry.cost;
    }),
  );
  const winners = scored.filter((entry) => {
    return entry.cost === best;
  });
  if (winners.length !== 1) {
    return undefined;
  }
  return winners[0]?.candidate;
}

/**
 * {@link closest} as a sentence to end a message with.
 *
 * @param name - The name as written.
 * @param candidates - The names it could have meant.
 * @returns ` Did you mean "x"?`, or an empty string.
 */
export function didYouMean(name: string, candidates: Iterable<string>): string {
  const meant = closest(name, candidates);
  if (meant === undefined) {
    return "";
  }
  return ` Did you mean ${JSON.stringify(meant)}?`;
}
