/**
 * Quote a value for safe interpolation into a `nextCommands` string an agent or
 * a human may paste into a shell. Values that come from the project or the
 * server — an origin, a cursor, a filter — are untrusted: origin validation
 * permits shell metacharacters, so a value such as one containing `$()` must not
 * be emitted raw into an executable command. A value made only of shell-safe
 * characters is returned as-is; anything else is wrapped in single quotes with
 * embedded quotes escaped.
 */
/**
 * `words` without the named options, in both spellings (`--cwd dir` and
 * `--cwd=dir`), each with its value. For a command line that is rebuilt with
 * those options appended again.
 */
export const withoutOptions = (words: readonly string[], options: readonly string[]): string[] => {
  const kept: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? "";
    if (options.includes(word)) {
      i += 1;
      continue;
    }
    if (options.some((option) => option.startsWith("--") && word.startsWith(`${option}=`))) {
      continue;
    }
    kept.push(word);
  }
  return kept;
};

export const shellArg = (value: string): string =>
  /^[A-Za-z0-9_.:@/=+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * An option and its value for a suggested command's text: `--cwd path`, but
 * `--cwd=-path` for a value that starts with a dash. A separate token would be
 * read as the next option rather than as this one's value, and quoting does not
 * prevent that — `--cwd '--force'` still parses as two options — so the value
 * is joined with `=`, which no parser splits. The argument-list form of the
 * same rule is `optionArgs` in `public-cli.ts`.
 */
export const shellOption = (option: string, value: string): string =>
  value.startsWith("-") ? `${option}=${shellArg(value)}` : `${option} ${shellArg(value)}`;
