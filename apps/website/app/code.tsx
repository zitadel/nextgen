import { Fragment, type ReactNode } from "react";
import { createCssVariablesTheme, createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import json from "shiki/langs/json.mjs";

// The code windows' JSON in the docs' syntax colours, coloured where the page
// is built: a server module, so the pages ship the coloured spans and never
// the highlighter. The theme is the docs' (apps/docs/lib/code-theme.ts), a
// copy: change both. Its colours are the --zl-shiki-* variables
// (globals.css), so code switches with the theme like everything else.
const theme = createCssVariablesTheme({ name: "zitadel", variablePrefix: "--zl-shiki-" });

const highlighter = createHighlighterCoreSync({
  themes: [theme],
  langs: [json],
  engine: createJavaScriptRegexEngine(),
});

// The text's own colour, which the window sets (CodeFile), so a token in it
// needs no span.
const FOREGROUND = "var(--zl-shiki-foreground)";

/**
 * JSON, coloured. A run of an object's members without its braces (a
 * schema's "properties": { … }) is coloured as inside one, so its first key
 * reads as a key.
 */
export function Json({ code }: { code: string }): ReactNode {
  const members = code.trimStart().startsWith('"');
  const lines = highlighter.codeToTokensBase(members ? `{\n${code}\n}` : code, {
    lang: "json",
    theme: "zitadel",
  });
  return (members ? lines.slice(1, -1) : lines).map((line, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the lines of a fixed document, never reordered
    <Fragment key={index}>
      {index > 0 && "\n"}
      {line.map(({ content, color }, at) =>
        color && color !== FOREGROUND ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the tokens of a fixed line, never reordered
          <span key={at} style={{ color }}>
            {content}
          </span>
        ) : (
          content
        ),
      )}
    </Fragment>
  ));
}
