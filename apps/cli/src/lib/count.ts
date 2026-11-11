/**
 * How many of something, as a clause: `1 schema`, `12 resources`. It is
 * derived from the noun's own forms rather than written per command, so every
 * command counts in the same words.
 */
export const renderCount = (count: number, opts: { singular: string; plural?: string }): string => {
  return `${count} ${count === 1 ? opts.singular : (opts.plural ?? `${opts.singular}s`)}`;
};
