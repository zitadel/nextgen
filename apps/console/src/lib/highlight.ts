import type { ThemedToken } from "shiki/core";

/**
 * Syntax highlighting for the schema document viewer.
 *
 * Shiki, on the same TextMate grammars VS Code uses, rather than a tokenizer of
 * our own. This started out hand-rolled — six colour roles did not seem to
 * justify a highlighting engine — and the YAML side was quietly wrong three
 * different ways: a `description` containing a newline serialises to a block
 * scalar whose continuation lines were read as `key: value`, a quoted key
 * containing a colon was split at the colon, and newlines were dropped. All of
 * them are the sort of thing a maintained grammar settled years ago.
 *
 * Two things keep the cost down. The JavaScript regex engine avoids shipping
 * the oniguruma WebAssembly build, and the fine-grained `shiki/core` entry
 * pulls in only the two grammars this screen renders. `shiki` is already a
 * workspace dependency (the docs site), so this resolves to the same version.
 *
 * Colour stays ours: the CSS-variables theme emits `var(--zl-shiki-*)`, which
 * `styles.css` aliases onto the design system's `syntax/*` roles so the code
 * block re-themes with `data-theme` like everything else (decisions log D12).
 */

export type CodeLanguage = "json" | "yaml";

/** One highlighted line. `color` is a `var(--zl-shiki-*)` reference. */
export type CodeLine = Pick<ThemedToken, "content" | "color">[];

const THEME = "zitadel";

/**
 * Built once and shared, and imported at call time rather than at module load.
 *
 * Compiling the grammars is far too expensive to repeat per render or per
 * format switch, and the engine plus both grammars is around 50 kB gzipped —
 * more than the rest of the schema detail screen put together. Loading it
 * dynamically keeps it out of the route's chunk, so the screen paints on the
 * document and the colour arrives with the highlighter.
 */
let highlighter: Promise<{ codeToTokens: HighlighterTokenizer }> | undefined;

type HighlighterTokenizer = (
  source: string,
  options: { lang: CodeLanguage; theme: string },
) => { tokens: ThemedToken[][] };

function getHighlighter() {
  highlighter ??= (async () => {
    const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] =
      await Promise.all([import("shiki/core"), import("shiki/engine/javascript")]);
    return createHighlighterCore({
      themes: [createCssVariablesTheme({ name: THEME, variablePrefix: "--zl-shiki-" })],
      langs: [import("shiki/langs/json.mjs"), import("shiki/langs/yaml.mjs")],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighter;
}

/**
 * Highlight a document into lines of coloured tokens.
 *
 * Returns tokens rather than HTML so the viewer renders real React elements —
 * the document is customer-authored, and nothing here needs to reach
 * `dangerouslySetInnerHTML` to be coloured.
 */
export async function highlightCode(source: string, lang: CodeLanguage): Promise<CodeLine[]> {
  const { tokens } = (await getHighlighter()).codeToTokens(source, { lang, theme: THEME });
  return tokens.map((line) => line.map(({ content, color }) => ({ content, color })));
}
