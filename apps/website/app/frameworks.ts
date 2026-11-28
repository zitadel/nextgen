// The frameworks `zitadel setup` scaffolds into today, as setup's
// --framework options list them (`setup --help`) and apps/cli/README.md's
// first line names them, the best known first. Change it with them; the
// front page names the first few and counts the rest (worksWith).
export const FRAMEWORKS = [
  "Next.js",
  "Nuxt",
  "SvelteKit",
  "TanStack Start",
  "React",
  "Vue",
  "Angular",
  "SolidStart",
  "Qwik Router",
  "Solid",
  "Svelte",
  "Qwik",
] as const;

// How many the front page names before it counts the rest.
const NAMED = 7;

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/**
 * "Works with Next.js, Nuxt, … and five more.": the first few by name, each
 * name kept on one line, the rest as a count.
 */
export function worksWith(): string {
  const named = FRAMEWORKS.slice(0, NAMED).map((name) => name.replaceAll(" ", " "));
  const rest = FRAMEWORKS.length - named.length;
  if (rest <= 0) {
    return `Works with ${named.slice(0, -1).join(", ")} and ${named.at(-1)}.`;
  }
  return `Works with ${named.join(", ")} and ${WORDS[rest] ?? rest} more.`;
}
