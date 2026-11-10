import { closest as nearest, distance } from "fastest-levenshtein";

/**
 * The one name a mistyped name most likely meant.
 *
 * @remarks
 * A different case, or a name one or two edits away, counts; a name of four
 * characters or fewer tolerates one. A name of one or two characters is as
 * close to a dozen others as to the one meant, so it names nothing, and so does
 * a tie, because guessing between two is no help.
 *
 * `fastest-levenshtein` finds the nearest candidate and measures it. Its
 * `closest` always answers, with the first of any tie and with no limit on how
 * far away, so the rest is the guard on top: a case-only match wins outright,
 * the nearest must be within the allowance, and the nearest of the remaining
 * candidates must be further away, or the two tie.
 *
 * @param name - The name as written.
 * @param candidates - The names it could have meant.
 * @returns The name it most likely meant, or `undefined`.
 */
export function closest(name: string, candidates: Iterable<string>): string | undefined {
  if (name.length < 3) {
    return undefined;
  }
  const others = [...new Set(candidates)].filter((candidate) => {
    return candidate !== name;
  });
  const recased = others.filter((candidate) => {
    return candidate.toLowerCase() === name.toLowerCase();
  });
  if (recased.length > 0) {
    return recased.length === 1 ? recased[0] : undefined;
  }
  if (others.length === 0) {
    return undefined;
  }
  const best = nearest(name, others);
  const cost = distance(name, best);
  if (cost > (name.length <= 4 ? 1 : 2)) {
    return undefined;
  }
  const rest = others.filter((candidate) => {
    return candidate !== best;
  });
  if (rest.length > 0 && distance(name, nearest(name, rest)) === cost) {
    return undefined;
  }
  return best;
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
