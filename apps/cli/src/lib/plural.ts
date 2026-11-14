/**
 * The regular English plural of a noun or a noun phrase, as its last word
 * forms it: `users`, `policies`, `addresses`, `identity providers`. A noun
 * with a plural of its own (`person`) is not known here; whoever holds such a
 * noun names its plural.
 *
 * @param noun - The singular, in lower case.
 * @returns The plural.
 */
export function regularPlural(noun: string): string {
  if (/[^aeiou]y$/.test(noun)) {
    return `${noun.slice(0, -1)}ies`;
  }
  if (/(?:s|x|z|ch|sh)$/.test(noun)) {
    return `${noun}es`;
  }
  return `${noun}s`;
}
